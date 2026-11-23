// ==UserScript==
// @name         Rotten Tomatoes on IMDb
// @author       cozzy
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Add Rotten Tomatoes critic consensus and scores to IMDb
// @match        *://*.imdb.com/title/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      rottentomatoes.com
// @downloadURL  https://raw.githubusercontent.com/yzzoc/RTonIMDB2/main/userscript.js
// @updateURL    https://raw.githubusercontent.com/yzzoc/RTonIMDB2/main/userscript.js
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const CONFIG = {
        debug: true,
        yearThreshold: 2,
        freshThreshold: 60,
        cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
        observerTimeoutMs: 12000,
        requestTimeoutMs: 10000,
        reattachCooldownMs: 1500,
    };

    const ICONS = {
        "certified-fresh": "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/cf-lg.3c29eff04f2.png",
        "fresh": "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-fresh-lg.12e316e31d2.png",
        "rotten": "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-rotten-lg.ecdfcf9596f.png",
        "upright": "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-upright.ac91cc241ac.png",
        "spilled": "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-spilled.844ba7ac3d0.png",
    };

    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    let isRunning = false;
    let persistenceStarted = false;
    let intentionalRemoval = false;
    let lastReattachAt = 0;

    function log(level, ...args) {
        if (level === "debug" && !CONFIG.debug) {
            return;
        }
        const fn = console[level] || console.log;
        fn.call(console, "[RTonIMDB2]", ...args);
    }

    function logDebugGroup(title, callback) {
        if (!CONFIG.debug) return;
        console.groupCollapsed(`[RTonIMDB2] ${title}`);
        try {
            callback();
        } finally {
            console.groupEnd();
        }
    }

    initWhenReady();

    function initWhenReady() {
        const start = () => {
            addCSS();
            waitForTargetContainer()
                .then((container) => {
                    startPanelPersistenceWatcher();
                    return runForContainer(container);
                })
                .catch((err) => log("warn", err.message));
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", start, { once: true });
        } else {
            start();
        }

        document.addEventListener("keydown", (event) => {
            if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "r") {
                event.preventDefault();
                log("debug", "Shortcut triggered (Ctrl+Alt+R)");
                pageWindow.rtRerun({ clearCache: true });
            }
        });
    }

    function getCacheKey(imdbMeta) {
        return `rt_cache_${imdbMeta.imdbId || `${imdbMeta.title}_${imdbMeta.year}`}`;
    }

    function removeExistingPanel() {
        const existingPanel = document.getElementById("rtScorePanel");
        if (existingPanel) {
            intentionalRemoval = true;
            existingPanel.remove();
            log("debug", "Removed existing #rtScorePanel");
            setTimeout(() => {
                intentionalRemoval = false;
            }, 50);
        }
    }

    pageWindow.rtRerun = async function rtRerun({ clearCache = false } = {}) {
        log("debug", "rtRerun called", { clearCache });
        removeExistingPanel();

        if (clearCache) {
            const imdbMeta = getImdbMetadata();
            const cacheKey = getCacheKey(imdbMeta);
            try {
                GM_setValue(cacheKey, "");
                log("debug", "Cleared cache entry", cacheKey);
            } catch (err) {
                log("warn", "Failed clearing cache entry:", err);
            }
        }

        addCSS();
        const container = await waitForTargetContainer();
        startPanelPersistenceWatcher();
        await runForContainer(container);
    };

    function findTargetContainer() {
        const reviewsList = document.querySelector('ul[data-testid="reviewContent-all-reviews"]');
        if (reviewsList && reviewsList.parentElement) {
            return reviewsList.parentElement;
        }
        return document.querySelector('[data-testid="UserReviews"]') || null;
    }

    function waitForTargetContainer() {
        return new Promise((resolve, reject) => {
            const existing = findTargetContainer();
            if (existing) {
                log("debug", "Found target container immediately:", existing.dataset?.testid || existing.tagName);
                resolve(existing);
                return;
            }

            const root = document.body || document.documentElement;
            if (!root) {
                reject(new Error("Document root unavailable."));
                return;
            }

            log("debug", "Waiting for target container via MutationObserver...");
            const observer = new MutationObserver(() => {
                const found = findTargetContainer();
                if (found) {
                    clearTimeout(timer);
                    observer.disconnect();
                    log("debug", "Target container appeared:", found.dataset?.testid || found.tagName);
                    resolve(found);
                }
            });

            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error("Timed out waiting for IMDb reviews container."));
            }, CONFIG.observerTimeoutMs);

            observer.observe(root, { childList: true, subtree: true });
        });
    }

    function startPanelPersistenceWatcher() {
        if (persistenceStarted) return;
        const root = document.body || document.documentElement;
        if (!root) return;

        persistenceStarted = true;
        log("debug", "Starting panel persistence watcher");

        const observer = new MutationObserver(() => {
            if (intentionalRemoval || isRunning) return;

            const panel = document.getElementById("rtScorePanel");
            if (!panel || !panel.isConnected) {
                const now = Date.now();
                if (now - lastReattachAt < CONFIG.reattachCooldownMs) {
                    return;
                }

                const container = findTargetContainer();
                if (container) {
                    lastReattachAt = now;
                    log("debug", "#rtScorePanel missing/detached while container exists; re-attaching", {
                        containerConnected: container.isConnected,
                        containerTestId: container.dataset?.testid || null,
                    });
                    runForContainer(container);
                }
            }
        });

        observer.observe(root, { childList: true, subtree: true });
    }

    async function runForContainer(container) {
        if (isRunning) {
            log("debug", "runForContainer already in progress; skipping duplicate call");
            return;
        }

        if (document.getElementById("rtScorePanel")) {
            log("debug", "Score panel already present; skipping duplicate append");
            return;
        }

        isRunning = true;
        try {
            const imdbMeta = getImdbMetadata();
            log("debug", "Extracted IMDb metadata:", imdbMeta);

            if (!imdbMeta.title) {
                log("warn", "Could not determine IMDb title.");
                return;
            }

            if (imdbMeta.mediaType === "tv_series") {
                log("debug", "Skipping TV series:", imdbMeta.title);
                return;
            }

            const currentContainer = container && container.isConnected ? container : findTargetContainer();
            if (!currentContainer) {
                log("warn", "Target container is not connected to DOM.");
                return;
            }

            const panel = createScorePanel();
            currentContainer.appendChild(panel);
            log("debug", "Appended #rtScorePanel to:", currentContainer.dataset?.testid || currentContainer.tagName);

            setTimeout(() => {
                const checkPanel = document.getElementById("rtScorePanel");
                log("debug", "Post-append check (1500ms):", {
                    panelConnected: Boolean(checkPanel && checkPanel.isConnected),
                    containerConnected: currentContainer.isConnected,
                });
            }, 1500);

            const cacheKey = getCacheKey(imdbMeta);
            const cached = getCachedEntry(cacheKey);
            if (cached) {
                logDebugGroup(`Cached Rotten Tomatoes data (${cacheKey})`, () => {
                    console.log(cached);
                });
                updatePanel(cached);
                return;
            }

            try {
                const rtUrl = await findRottenTomatoesUrl(imdbMeta);
                if (!rtUrl) {
                    log("warn", "No matching Rotten Tomatoes entry found for:", imdbMeta);
                    showPanelError("No matching Rotten Tomatoes entry found.");
                    return;
                }

                log("debug", "Selected Rotten Tomatoes URL:", rtUrl);
                const scoreData = await fetchRottenTomatoesScores(rtUrl);
                if (!scoreData) {
                    log("warn", "Could not parse Rotten Tomatoes score data for:", rtUrl);
                    showPanelError("Could not parse Rotten Tomatoes score data.");
                    return;
                }

                logDebugGroup("Final normalized Rotten Tomatoes payload", () => {
                    console.log({
                        url: scoreData.url,
                        title: scoreData.title,
                        criticScore: scoreData.criticScore,
                        criticCertified: scoreData.criticCertified,
                        criticReviewCount: scoreData.criticReviewCount,
                        audienceScore: scoreData.audienceScore,
                        audienceReviewCount: scoreData.audienceReviewCount,
                        isConsensusFallback: scoreData.isConsensusFallback,
                        consensus: scoreData.consensus,
                    });
                });

                setCachedEntry(cacheKey, scoreData);
                updatePanel(scoreData);
            } catch (err) {
                log("error", "Lookup failed:", err);
                showPanelError("Unable to load Rotten Tomatoes scores.");
            }
        } finally {
            isRunning = false;
        }
    }

    function getLdJsonObject() {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            try {
                const parsed = JSON.parse(script.textContent || "{}");
                if (parsed && (parsed["@type"] === "Movie" || parsed["@type"] === "TVSeries")) {
                    return parsed;
                }
            } catch (_) {
                // Ignore malformed JSON-LD blocks
            }
        }
        return null;
    }

    function getImdbMetadata() {
        const ld = getLdJsonObject();
        const idMatch = window.location.pathname.match(/\/title\/(tt\d+)/);
        const imdbId = idMatch ? idMatch[1] : null;

        let title = ld && ld.name ? decodeHtmlEntities(String(ld.name)).trim() : "";
        if (!title) {
            const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
            title = ogTitle.replace(/\s*\(\d{4}[^)]*\)\s*-\s*IMDb$/i, "").replace(/\s*-\s*IMDb$/i, "").trim();
        }
        if (!title) {
            title = (document.querySelector('[data-testid="hero__primary-text"]')?.textContent || "").trim();
        }

        let year = null;
        if (ld && ld.datePublished) {
            const parsedYear = parseInt(String(ld.datePublished).slice(0, 4), 10);
            if (!Number.isNaN(parsedYear)) year = parsedYear;
        }
        if (!year) {
            const releaseLinkText = document.querySelector('a[href*="ref_=tt_ov_rdat"]')?.textContent || "";
            const yearMatch = releaseLinkText.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) year = parseInt(yearMatch[0], 10);
        }

        let mediaType = "movie";
        if (ld && ld["@type"] === "TVSeries") {
            mediaType = "tv_series";
        } else {
            const headerText = document.querySelector('[data-testid="hero-title-block__metadata"]')?.textContent || "";
            if (/TV Series/i.test(headerText)) {
                mediaType = "tv_series";
            } else if (/TV Movie/i.test(headerText)) {
                mediaType = "tv_movie";
            }
        }

        let director = "";
        if (ld && ld.director) {
            const dirObj = Array.isArray(ld.director) ? ld.director[0] : ld.director;
            if (dirObj && dirObj.name) {
                director = decodeHtmlEntities(String(dirObj.name)).trim();
            }
        }
        if (!director) {
            const creditItems = document.querySelectorAll('[data-testid="title-pc-principal-credit"] a');
            if (creditItems.length > 0) {
                director = (creditItems[0].textContent || "").trim();
            }
        }

        return { imdbId, title, year, mediaType, director };
    }

    function decodeHtmlEntities(str) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = str;
        return textarea.value;
    }

    function normalizeTitle(str) {
        return String(str || "")
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseScorePercent(raw) {
        if (raw === null || raw === undefined || raw === "") return null;
        const cleaned = String(raw).replace("%", "").trim();
        const num = Number(cleaned);
        return Number.isNaN(num) ? null : num;
    }

    function gmRequest(url) {
        log("debug", "Requesting URL:", url);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                timeout: CONFIG.requestTimeoutMs,
                headers: {
                    "Accept": "text/html,application/xhtml+xml",
                },
                onload(response) {
                    log("debug", `Response ${response.status} from ${url} (${response.responseText?.length || 0} chars)`);
                    if (response.status >= 200 && response.status < 300 && response.responseText) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP ${response.status} for ${url}`));
                    }
                },
                onerror() {
                    reject(new Error(`Network error requesting ${url}`));
                },
                ontimeout() {
                    reject(new Error(`Request timed out for ${url}`));
                },
            });
        });
    }

    async function findRottenTomatoesUrl(imdbMeta) {
        const query = imdbMeta.director ? `${imdbMeta.title} ${imdbMeta.director}` : imdbMeta.title;
        const params = new URLSearchParams({ search: query });
        const searchUrl = `https://www.rottentomatoes.com/search?${params.toString()}`;

        const html = await gmRequest(searchUrl);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const rows = Array.from(doc.getElementsByTagName("search-page-media-row"));

        log("debug", `Found ${rows.length} search result rows`);
        if (rows.length === 0) {
            return null;
        }

        const targetNorm = normalizeTitle(imdbMeta.title);
        const dirNorm = normalizeTitle(imdbMeta.director);

        let bestMatch = null;
        let bestScore = -Infinity;
        const evaluated = [];

        for (const row of rows) {
            const releaseYearRaw = parseInt(row.getAttribute("releaseyear") || "", 10);
            const hasValidYear = !Number.isNaN(releaseYearRaw);

            if (imdbMeta.year && hasValidYear) {
                const diff = Math.abs(releaseYearRaw - imdbMeta.year);
                if (diff > CONFIG.yearThreshold) {
                    continue;
                }
            }

            const links = Array.from(row.getElementsByTagName("a"));
            const titleLink = links.find((a) => (a.textContent || "").trim().length > 0) || links[0];
            const href = titleLink ? titleLink.getAttribute("href") : null;
            if (!href) continue;

            const candidateTitle = (titleLink.textContent || "").trim();
            const candidateNorm = normalizeTitle(candidateTitle);
            const castText = normalizeTitle(row.getAttribute("cast") || "");

            let score = 0;
            if (candidateNorm === targetNorm) {
                score += 50;
            } else if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) {
                score += 25;
            }

            if (imdbMeta.year && hasValidYear) {
                const yearDiff = Math.abs(releaseYearRaw - imdbMeta.year);
                score += Math.max(0, 30 - yearDiff * 10);
            }

            if (dirNorm && castText.includes(dirNorm)) {
                score += 15;
            }

            const fullUrl = href.startsWith("http") ? href : new URL(href, "https://www.rottentomatoes.com").href;
            evaluated.push({ title: candidateTitle, year: releaseYearRaw, score, url: fullUrl });

            if (score > bestScore) {
                bestScore = score;
                bestMatch = fullUrl;
            }
        }

        if (CONFIG.debug && evaluated.length > 0) {
            logDebugGroup(`Candidate search matches (${evaluated.length} within ±${CONFIG.yearThreshold}y)`, () => {
                console.table(evaluated);
                console.log("Best match:", { bestMatch, bestScore });
            });
        }

        return bestMatch;
    }

    async function fetchRottenTomatoesScores(url) {
        const html = await gmRequest(url);
        const doc = new DOMParser().parseFromString(html, "text/html");

        let scoreJson = null;
        const jsonEl = doc.getElementById("media-scorecard-json");
        if (jsonEl && jsonEl.textContent) {
            try {
                scoreJson = JSON.parse(jsonEl.textContent);
            } catch (err) {
                log("warn", "Failed parsing media-scorecard-json:", err);
            }
        } else {
            log("warn", "Missing #media-scorecard-json element on page");
        }

        const domTitle = (doc.querySelector('rt-text[slot="title"]')?.textContent || "").trim();
        const title = domTitle || "Rotten Tomatoes";

        let consensus = "";
        let isConsensusFallback = false;
        const consensusContainer = doc.getElementById("critics-consensus");
        const consensusParagraph = consensusContainer ? consensusContainer.querySelector("p") : null;
        if (consensusParagraph) {
            consensus = (consensusParagraph.textContent || "").replace(/\s+/g, " ").trim();
        }
        if (!consensus) {
            consensus = "No consensus.";
            isConsensusFallback = true;
        }

        const criticRawScore = scoreJson?.criticsScore?.scorePercent ?? scoreJson?.criticsScore?.score ?? null;
        const criticScore = parseScorePercent(criticRawScore);
        const criticCertified =
            scoreJson?.criticsScore?.certified === true ||
            String(scoreJson?.criticsScore?.certified).toLowerCase() === "true";
        const criticReviewCount =
            scoreJson?.criticsScore?.reviewCount ??
            scoreJson?.overlay?.criticsAll?.reviewCount ??
            "N/A";

        const audienceRawScore = scoreJson?.audienceScore?.scorePercent ?? scoreJson?.audienceScore?.score ?? null;
        const audienceScore = parseScorePercent(audienceRawScore);
        const audienceReviewCount =
            scoreJson?.audienceScore?.bandedRatingCount ??
            scoreJson?.audienceScore?.reviewCount ??
            scoreJson?.overlay?.audienceAll?.bandedRatingCount ??
            "Not yet available";

        logDebugGroup(`Fetched Rotten Tomatoes page data (${url})`, () => {
            console.log("Raw #media-scorecard-json:", scoreJson);
            console.log("DOM extraction:", {
                domTitle,
                hasConsensusContainer: Boolean(consensusContainer),
                hasConsensusParagraph: Boolean(consensusParagraph),
                consensus,
                isConsensusFallback,
            });
            console.log("Extracted scores:", {
                criticScore,
                criticCertified,
                criticReviewCount,
                audienceScore,
                audienceReviewCount,
            });
        });

        return {
            url,
            title,
            consensus,
            isConsensusFallback,
            criticScore,
            criticCertified,
            criticReviewCount,
            audienceScore,
            audienceReviewCount,
        };
    }

    function scoreToState(score, certified, isCritic) {
        const numericScore = Number(score);
        if (Number.isNaN(numericScore)) {
            return isCritic ? "rotten" : "spilled";
        }

        if (isCritic) {
            if (numericScore >= CONFIG.freshThreshold && certified) {
                return "certified-fresh";
            }
            return numericScore >= CONFIG.freshThreshold ? "fresh" : "rotten";
        }

        return numericScore >= CONFIG.freshThreshold ? "upright" : "spilled";
    }

    function createScorePanel() {
        const panel = document.createElement("div");
        panel.id = "rtScorePanel";

        panel.innerHTML = `
            <div id="rtHeader">
                <div class="rtHeaderTop">
                    <span class="rtBadge">Rotten Tomatoes</span>
                    <div class="rtHeaderActions">
                        <button type="button" id="rtRefreshBtn" class="rtRefreshBtn" title="Clear cache and refresh Rotten Tomatoes data" aria-label="Refresh Rotten Tomatoes data">
                            <span class="rtRefreshIcon" aria-hidden="true">↻</span>
                            <span>Refresh</span>
                        </button>
                        <a id="rtHeaderExtLink" class="rtExtHint" target="_blank" rel="noopener noreferrer">View on RT ↗</a>
                    </div>
                </div>
                <a id="rtLink" target="_blank" rel="noopener noreferrer">
                    <h2 id="rtTitle">Loading Rotten Tomatoes...</h2>
                </a>
            </div>

            <div id="rtCriticsConsensus">
                <div class="rtLoaderWrap">
                    <svg width="96" height="24" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg" fill="#a1a1aa" aria-label="Loading">
                        <circle cx="15" cy="15" r="11">
                            <animate attributeName="r" from="11" to="11" begin="0s" dur="0.8s" values="11;7;11" calcMode="linear" repeatCount="indefinite" />
                            <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s" values="1;.4;1" calcMode="linear" repeatCount="indefinite" />
                        </circle>
                        <circle cx="60" cy="15" r="7" fill-opacity="0.4">
                            <animate attributeName="r" from="7" to="7" begin="0s" dur="0.8s" values="7;11;7" calcMode="linear" repeatCount="indefinite" />
                            <animate attributeName="fill-opacity" from="0.4" to="0.4" begin="0s" dur="0.8s" values=".4;1;.4" calcMode="linear" repeatCount="indefinite" />
                        </circle>
                        <circle cx="105" cy="15" r="11">
                            <animate attributeName="r" from="11" to="11" begin="0s" dur="0.8s" values="11;7;11" calcMode="linear" repeatCount="indefinite" />
                            <animate attributeName="fill-opacity" from="1" to="1" begin="0s" dur="0.8s" values="1;.4;1" calcMode="linear" repeatCount="indefinite" />
                        </circle>
                    </svg>
                </div>
            </div>

            <div class="rtScoresGrid">
                <div class="rtScoreCard" id="rtCriticCard">
                    <a id="rtCriticLink" class="rtScoreRow" target="_blank" rel="noopener noreferrer">
                        <span id="rtCriticIcon" class="icon"></span>
                        <span class="rtScorePrimary" id="rtCriticPercent"></span>
                    </a>
                    <div class="rtScoreDetails">
                        <div class="rtCardLabel">Tomatometer</div>
                        <div class="rtMetaLine">
                            <span class="rtRatingsSmallText">Reviews:</span>
                            <strong class="rtRatingsSmallText rtRatingsValue" id="rtCriticRatingsCount">N/A</strong>
                        </div>
                    </div>
                </div>

                <div class="rtScoreCard" id="rtAudienceCard">
                    <a id="rtAudienceLink" class="rtScoreRow" target="_blank" rel="noopener noreferrer">
                        <span id="rtAudienceIcon" class="icon"></span>
                        <span class="rtScorePrimary" id="rtAudiencePercent"></span>
                    </a>
                    <div class="rtScoreDetails">
                        <div class="rtCardLabel">Audience Score</div>
                        <div class="rtMetaLine">
                            <strong class="rtRatingsSmallText rtRatingsValue" id="rtAudienceRatingsCount">N/A</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const refreshBtn = panel.querySelector("#rtRefreshBtn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (refreshBtn.classList.contains("is-refreshing")) return;
                refreshBtn.classList.add("is-refreshing");
                refreshBtn.disabled = true;
                log("debug", "Refresh button clicked; clearing cache and re-running");
                pageWindow.rtRerun({ clearCache: true });
            });
        }

        return panel;
    }

    function applyCardTone(cardEl, state) {
        if (!cardEl) return;
        cardEl.classList.remove("tone-fresh", "tone-rotten");
        if (state === "certified-fresh" || state === "fresh" || state === "upright") {
            cardEl.classList.add("tone-fresh");
        } else if (state === "rotten" || state === "spilled") {
            cardEl.classList.add("tone-rotten");
        }
    }

    function updatePanel(data) {
        const titleEl = document.getElementById("rtTitle");
        const consensusEl = document.getElementById("rtCriticsConsensus");
        const criticCardEl = document.getElementById("rtCriticCard");
        const criticIconEl = document.getElementById("rtCriticIcon");
        const criticPercentEl = document.getElementById("rtCriticPercent");
        const criticCountEl = document.getElementById("rtCriticRatingsCount");
        const audienceCardEl = document.getElementById("rtAudienceCard");
        const audienceIconEl = document.getElementById("rtAudienceIcon");
        const audiencePercentEl = document.getElementById("rtAudiencePercent");
        const audienceCountEl = document.getElementById("rtAudienceRatingsCount");

        if (!titleEl || !consensusEl) return;

        titleEl.textContent = data.title || "Rotten Tomatoes";

        consensusEl.textContent = "";
        if (data.isConsensusFallback) {
            const em = document.createElement("em");
            em.textContent = data.consensus;
            consensusEl.appendChild(em);
        } else {
            consensusEl.textContent = data.consensus;
        }

        if (data.url) {
            document.getElementById("rtLink")?.setAttribute("href", data.url);
            document.getElementById("rtHeaderExtLink")?.setAttribute("href", data.url);
            document.getElementById("rtCriticLink")?.setAttribute("href", `${data.url}#contentReviews`);
            document.getElementById("rtAudienceLink")?.setAttribute("href", `${data.url}#audience_reviews`);
        }

        criticPercentEl.textContent = "";
        if (data.criticScore === null || data.criticScore === undefined || data.criticScore === "") {
            criticIconEl.className = "icon icon-muted";
            applyCardTone(criticCardEl, null);
            const unavailable = document.createElement("span");
            unavailable.className = "rtNotAvailable";
            unavailable.textContent = "Not Yet Available";
            criticPercentEl.appendChild(unavailable);
            criticCountEl.textContent = "N/A";
        } else {
            const criticState = scoreToState(data.criticScore, data.criticCertified, true);
            criticIconEl.className = `icon ${criticState}`;
            applyCardTone(criticCardEl, criticState);
            const pctSpan = document.createElement("span");
            pctSpan.className = "rtPercent";
            pctSpan.textContent = `${data.criticScore}%`;
            criticPercentEl.appendChild(pctSpan);
            criticCountEl.textContent = String(data.criticReviewCount);
        }

        audiencePercentEl.textContent = "";
        if (data.audienceScore === null || data.audienceScore === undefined || data.audienceScore === "") {
            audienceIconEl.className = "icon icon-muted";
            applyCardTone(audienceCardEl, null);
            const comingSoon = document.createElement("span");
            comingSoon.className = "rtNotAvailable rtAudienceNotAvailable";
            comingSoon.textContent = "Coming soon";
            audiencePercentEl.appendChild(comingSoon);
            audienceCountEl.textContent = "Not yet available";
        } else {
            const audienceState = scoreToState(data.audienceScore, false, false);
            audienceIconEl.className = `icon ${audienceState}`;
            applyCardTone(audienceCardEl, audienceState);
            const pctSpan = document.createElement("span");
            pctSpan.className = "rtPercent";
            pctSpan.textContent = `${data.audienceScore}%`;
            audiencePercentEl.appendChild(pctSpan);
            audienceCountEl.textContent = String(data.audienceReviewCount);
        }
    }

    function showPanelError(message) {
        const titleEl = document.getElementById("rtTitle");
        const consensusEl = document.getElementById("rtCriticsConsensus");
        if (titleEl) titleEl.textContent = "Rotten Tomatoes";
        if (consensusEl) {
            consensusEl.textContent = "";
            const em = document.createElement("em");
            em.textContent = message;
            consensusEl.appendChild(em);
        }
    }

    function getCachedEntry(key) {
        try {
            const raw = GM_getValue(key, null);
            if (!raw) return null;
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (!parsed || !parsed.timestamp || !parsed.data) return null;
            if (Date.now() - parsed.timestamp > CONFIG.cacheTtlMs) {
                log("debug", "Cache expired for:", key);
                return null;
            }
            return parsed.data;
        } catch (err) {
            log("warn", "Failed reading cache entry:", err);
            return null;
        }
    }

    function setCachedEntry(key, data) {
        try {
            GM_setValue(key, JSON.stringify({ timestamp: Date.now(), data }));
            log("debug", "Saved cache entry:", key);
        } catch (err) {
            log("warn", "Failed saving cache entry:", err);
        }
    }

    function addCSS() {
        if (document.getElementById("rtScorePanelStyles")) return;

        const style = document.createElement("style");
        style.id = "rtScorePanelStyles";
        style.textContent = `
            #rtScorePanel,
            #rtScorePanel * {
                box-sizing: border-box;
                min-width: 0;
            }

            #rtScorePanel {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin-top: 18px;
                padding: 16px 18px;
                background: #17171a;
                border: 1px solid rgba(255, 255, 255, 0.11);
                border-radius: 10px;
                color: #f4f4f5;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
                font-family: "Franklin Gothic Medium", "Roboto", Arial, sans-serif;
            }

            #rtHeader {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding-bottom: 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }

            .rtHeaderTop {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }

            .rtHeaderActions {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                flex: 0 0 auto;
            }

            .rtBadge {
                flex: 0 0 auto;
                padding: 3px 8px;
                border-radius: 5px;
                background: rgba(250, 50, 10, 0.16);
                border: 1px solid rgba(250, 50, 10, 0.38);
                color: #ff6e50;
                font-size: 10.5px;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }

            .rtRefreshBtn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 3px 8px;
                border-radius: 5px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.04);
                color: #d4d4d8;
                font-family: inherit;
                font-size: 11.5px;
                font-weight: 500;
                line-height: 1.2;
                cursor: pointer;
                transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
            }

            .rtRefreshBtn:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.09);
                border-color: rgba(255, 255, 255, 0.24);
                color: #ffffff;
            }

            .rtRefreshBtn:disabled {
                opacity: 0.65;
                cursor: default;
            }

            .rtRefreshIcon {
                display: inline-block;
                font-size: 12px;
                line-height: 1;
            }

            .rtRefreshBtn.is-refreshing .rtRefreshIcon {
                animation: rtSpin 0.8s linear infinite;
            }

            @keyframes rtSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            #rtLink {
                display: block;
            }

            #rtTitle {
                margin: 0;
                font-size: 16.5px;
                font-weight: 600;
                line-height: 1.3;
                letter-spacing: 0.015em;
                color: #ffffff;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                overflow-wrap: anywhere;
                transition: color 0.15s ease;
            }

            #rtLink:hover #rtTitle {
                color: #ff6e50;
            }

            .rtExtHint {
                flex: 0 0 auto;
                font-size: 12px;
                color: #a1a1aa;
                white-space: nowrap;
                transition: color 0.15s ease;
            }

            .rtExtHint:hover {
                color: #ffffff;
            }

            #rtCriticsConsensus {
                padding: 10px 14px;
                font-size: 13.5px;
                line-height: 1.5;
                color: #d4d4d8;
                background: rgba(255, 255, 255, 0.025);
                border-left: 3px solid rgba(255, 110, 80, 0.55);
                border-radius: 0 6px 6px 0;
                overflow-wrap: anywhere;
            }

            #rtCriticsConsensus em {
                color: #a1a1aa;
            }

            .rtLoaderWrap {
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 4px 0;
            }

            .rtScoresGrid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 12px;
            }

            .rtScoreCard {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                padding: 12px 14px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                transition: border-color 0.15s ease, background-color 0.15s ease;
            }

            .rtScoreCard:hover {
                background: rgba(255, 255, 255, 0.05);
                border-color: rgba(255, 255, 255, 0.16);
            }

            .rtScoreCard.tone-fresh {
                border-color: rgba(250, 50, 10, 0.26);
                background: linear-gradient(135deg, rgba(250, 50, 10, 0.06), rgba(255, 255, 255, 0.025));
            }

            .rtScoreCard.tone-rotten {
                border-color: rgba(163, 230, 53, 0.2);
                background: linear-gradient(135deg, rgba(163, 230, 53, 0.05), rgba(255, 255, 255, 0.025));
            }

            .rtScoreRow {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                flex: 0 0 auto;
            }

            .rtScorePrimary {
                display: inline-flex;
                align-items: center;
            }

            .rtScoreDetails {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                text-align: right;
                gap: 3px;
                flex: 1 1 auto;
                overflow: hidden;
            }

            #rtLink, #rtCriticLink, #rtAudienceLink, .rtExtHint {
                text-decoration: none !important;
            }

            .icon {
                height: 36px;
                width: 36px;
                flex: 0 0 36px;
                display: inline-block;
                background-repeat: no-repeat;
                background-position: center;
                background-size: contain;
            }

            .icon.icon-muted {
                opacity: 0.35;
                background-color: rgba(255, 255, 255, 0.06);
                border-radius: 50%;
            }

            .certified-fresh, .certified_fresh {
                background-image: url("${ICONS["certified-fresh"]}");
            }

            .fresh {
                background-image: url("${ICONS["fresh"]}");
            }

            .rotten {
                background-image: url("${ICONS["rotten"]}");
            }

            .upright {
                background-image: url("${ICONS["upright"]}");
            }

            .spilled {
                background-image: url("${ICONS["spilled"]}");
            }

            .rtPercent {
                font-size: 28px;
                font-weight: 700;
                line-height: 1;
                color: #ffffff;
                font-variant-numeric: tabular-nums;
            }

            .rtCardLabel {
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.07em;
                text-transform: uppercase;
                color: #a1a1aa;
            }

            .rtMetaLine {
                display: flex;
                align-items: baseline;
                justify-content: flex-end;
                gap: 5px;
                font-variant-numeric: tabular-nums;
                overflow-wrap: anywhere;
            }

            .rtNotAvailable {
                font-size: 12.5px;
                color: #a1a1aa;
                font-weight: 500;
                line-height: 1.25;
                max-width: 110px;
            }

            .rtAudienceNotAvailable {
                font-style: italic;
            }

            .rtRatingsSmallText {
                font-size: 12px;
                font-weight: 400;
                color: #a1a1aa;
            }

            .rtRatingsValue {
                font-weight: 600;
                color: #e4e4e7;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }
})();