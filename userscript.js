// ==UserScript==
// @name         Rotten Tomatoes on IMDB 2
// @author       cozzy
// @namespace    http://tampermonkey.net/
// @version      2
// @description  Add rotten tomatoes critic conesesus and scores to imdb
// @match        *.imdb.com/title/*
// @grant        GM_xmlhttpRequest
// @connect      rottentomatoes.com
// @run-at document-start
// ==/UserScript==

window.onload = main;


function main(){

    // Add custom CSS styles to the page
    addCSS();

    // Get the element where the score panel will be appended
    const IMDB_APPEND = document.querySelector("ul[data-testid=reviewContent-all-reviews]").parentElement;

    // Check if the media is a TV series (we don't want to display the score panel for TV movies)
    if(getMediaType() != 2){

        // Create the score panel element
        var sp = createScorePanel();

        // Append the score panel to the page
        if(IMDB_APPEND){
            IMDB_APPEND.appendChild(sp);
            getRottenTomatoes(sp, getTitle());
        }
        else
        {
            console.log("Failed to attach score panel.")
        }
    }
}


// Get the title of the movie or TV series from the page meta tags
function getTitle(){

    // Get all meta tags on the page
    const meta = document.getElementsByTagName("meta");

    // Loop through the meta tags and find the one with the "og:title" property
    for(let i = 0; i < meta.length; i++){
        if(meta[i].getAttribute("property") === "og:title"){

            // Return the title, removing the " - IMDb" suffix
            return meta[i].getAttribute("content").split(/\(.*\) - IMDb$/)[0];
        }
    }
}


// Get the media type (movie or TV series) from the page
function getMediaType(){

    // Return
    // 1 for tv movie
    // 2 for tv series
    // 0 for anything else

    // Get the media type from the page
    var type = document.getElementsByClassName("ipc-inline-list ipc-inline-list--show-dividers")[1].firstChild.innerHTML;

    // Check the media type and return the appropriate value
    if(type === "TV Movie"){
        return 1;
    }
    else if(type === "TV Series"){
        return 2;
    }
    else{
        return 0;
    }
}


// Create the score panel element
function createScorePanel(){

    // Create a div element for the panel
    var panel = document.createElement("div");

    // Set the ID of the panel
    panel.setAttribute("id", "rtScorePanel");

    // Add a loading icon to the panel while we make the request to Rotten Tomatoes
    const loadingIcon = `
    <svg width="120" height="30" viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg" fill="#fff">
        <circle cx="15" cy="15" r="15">
            <animate attributeName="r" from="15" to="15"
                    begin="0s" dur="0.8s"
                    values="15;9;15" calcMode="linear"
                    repeatCount="indefinite" />
            <animate attributeName="fill-opacity" from="1" to="1"
                    begin="0s" dur="0.8s"
                    values="1;.5;1" calcMode="linear"
                    repeatCount="indefinite" />
        </circle>
        <circle cx="60" cy="15" r="9" fill-opacity="0.3">
            <animate attributeName="r" from="9" to="9"
                    begin="0s" dur="0.8s"
                    values="9;15;9" calcMode="linear"
                    repeatCount="indefinite" />
            <animate attributeName="fill-opacity" from="0.5" to="0.5"
                    begin="0s" dur="0.8s"
                    values=".5;1;.5" calcMode="linear"
                    repeatCount="indefinite" />
        </circle>
        <circle cx="105" cy="15" r="15">
            <animate attributeName="r" from="15" to="15"
                    begin="0s" dur="0.8s"
                    values="15;9;15" calcMode="linear"
                    repeatCount="indefinite" />
            <animate attributeName="fill-opacity" from="1" to="1"
                    begin="0s" dur="0.8s"
                    values="1;.5;1" calcMode="linear"
                    repeatCount="indefinite" />
        </circle>
    </svg>`


    panel.innerHTML +=
    `
            <div id='rtHeader'>
                <a id='rtLink'>
                    <h1 id='rtTitle'></h1>
                </a>
            </div>
            <div id='rtCriticsConsensus'>` + loadingIcon + `</div>

            <div class='rtCriticScore'>
                <a id='rtCriticLink'>
                    <span id='rtCriticIcon'></span>
                    <h1 class='rtPercent' id='rtCriticPercent'></h1>
                </a>
            </div>

            <div class='rtAudienceScore'>
                <a id='rtAudienceLink'>
                    <span id='rtAudienceIcon'></span>
                    <h1 class='rtPercent' id='rtAudiencePercent'></h1>
                </a>
            </div>

            <div class='rtCriticScore'>
                <strong class='rtRatingsSmallText'>Total Count: </strong>
                <strong class='rtRatingsSmallText' id='rtCriticRatingsCount'>N/A</strong>
            </div>
            <div class='rtAudienceScore'>
                <strong class='rtRatingsSmallText'>User Ratings: </strong>
                <strong class='rtRatingsSmallText' id='rtAudienceRatingsCount'>N/A</strong>
            </div>
    `

    return panel;
}


// Make a request to Rotten Tomatoes to get the critic consensus and score
function getRottenTomatoes(){

    // getRottenTomatoes(sp, title)
    // Takes a scorepanel object and title
    // GETs a search result for title + director, checks the results for a movie within y_threshold years.
    // If a result is found, calls getScores


    // Maximum difference in release year between the movie or TV series on IMDb and the one on Rotten Tomatoes
    const y_threshold = 2;

    // The release year of the movie or TV series on IMDb
    var year;

    // Get the title of the movie or TV series
    var title = getTitle();

    // Remove special characters from the title
    title = title.replace(/& |\[|\]|"|:|, |-|\./g, "");
    title = title.replace(/²/, "2");
    title = title.replace(/³/g, "3");
    title = title.replace(/ /g, "%20");

    // Create the search URL for Rotten Tomatoes
    var search_url = "https://www.rottentomatoes.com/search?search=" + title;

    // If the media is a movie, add the director to the search query
    if(!getMediaType()){
        const director = (document.getElementsByClassName("ipc-metadata-list-item__list-content-item ipc-metadata-list-item__list-content-item--link")[0].innerHTML.replace(/ /g, "%20"))
        search_url += "%20" + director;
        year = parseInt(document.getElementsByClassName("sc-f26752fb-1 hMnkBf")[0].innerHTML);
    }
    // If the media is a TV series, get the release year from the first season
    else {
        year = parseInt(document.getElementsByClassName("sc-f26752fb-1 hMnkBf")[0].innerHTML.substring(0,4));
    }

    // Log the search URL
    console.log("Requesting " + search_url);

    // Make a GET request to Rotten Tomatoes
    GM_xmlhttpRequest({
        method: "GET",
        url: search_url,
        onload: function(response){

            // Parse the response HTML
            var parser = new DOMParser();
            var parsedPage = parser.parseFromString(response.responseText, "text/html");

            // If the media is a movie or TV movie, get the search results
            if(!getMediaType() || getMediaType() == 1){
                var results = parsedPage.getElementsByTagName("search-page-media-row");

                // Loop through the search results and find the one that matches the movie or TV series on IMDb
                for(let i = 0; i < results.length; i++){
                    // Check if the release year of the search result is within the threshold
                    if(parseInt(results[i].getAttribute("releaseyear")) > year - y_threshold && parseInt(results[i].getAttribute("releaseyear")) < year + y_threshold){

                        console.log("MOVIE:    " + results[i].getElementsByTagName("a")[1].innerHTML.trim() +
                                    "\nYEAR:     " + results[i].getAttribute("releaseyear") +
                                    "\nCAST:     " + results[i].getAttribute("cast") +
                                    "\nSCORE:    " + results[i].getAttribute("tomatometerscore") + "%");

                        getScores(results[i].getElementsByTagName("a")[0].href);
                        break;
                    }
                    else{
                        console.log("ERROR: Year check failed, usually means imdb has changed some elements.");
                    }
                }
            }
        }
    });
}


// Make a request to Rotten Tomatoes to get the critic consensus and score
function getScores(url){

    // Make a GET request to the URL of the movie or TV series on Rotten Tomatoes
    GM_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function(response) {

            // Parse the response HTML
            var parser = new DOMParser();
            var doc = parser.parseFromString(response.responseText, "text/html");

            // Get the JSON object containing the critic scores
            var scoreJSON = (JSON.parse(doc.getElementById("score-details-json").innerHTML)).scoreboard;

            // If the scoreJSON object exists, get the critic consensus
            if(scoreJSON){
                if(doc.getElementsByClassName("what-to-know__section-body")[0]){
                    scoreJSON.consensus = doc.getElementsByClassName("what-to-know__section-body")[0].children[0].innerHTML;
                }
                else{
                    // If there is no consensus, set it to "No consensus"
                    scoreJSON.consensus = "<em>No consensus.</em>"
                }
            }

            // Call the setHref and updatePanel functions
            setHref(url);
            updatePanel(scoreJSON);
        }
    });
}


// Update the score panel with the movie or TV series title, critic consensus, critic score, and audience score
function updatePanel(data){

    // If the data object exists, update the score panel with the movie or TV series title, critic consensus, critic score, and audience score
    if(data){
        // Update the title of the movie or TV series
        document.getElementById("rtTitle").innerHTML = data.title;

        // Update the critic consensus
        document.getElementById("rtCriticsConsensus").innerHTML = data.consensus;

        // If the critic score is not available, update the score panel with "Tomatometer Not Yet Available"
        if(!data.tomatometerScore.value){
            document.getElementById("rtCriticPercent").innerHTML = "<div class='rtCriticNotAvailable'>Tomatometer <br> Not Yet Available</div>";
        }
        else{
            // If the critic score is available, update the score panel with the score and number of ratings
            document.getElementById("rtCriticIcon").setAttribute("class", "icon " + data.tomatometerScore.state);
            document.getElementById("rtCriticPercent").innerHTML = data.tomatometerScore.value + "%";
            document.getElementById("rtCriticRatingsCount").innerHTML = data.tomatometerScore.reviewCount;
        }

        // If the audience score is not available, update the score panel with "Coming Soon"
        if(!data.audienceScore.value){
            document.getElementById("rtAudiencePercent").innerHTML = "<p class='rtAudienceNotAvailable'>Coming soon</p>";
            document.getElementById("rtAudienceRatingsCount").innerHTML = "Not yet available";
        }
        else{
            // If the audience score is available, update the score panel with the score and number of ratings
            if(data.audienceScore.state){
                document.getElementById("rtAudienceIcon").setAttribute("class", "icon " + data.audienceScore.state);
            }
            document.getElementById("rtAudiencePercent").innerHTML = data.audienceScore.value + "%";
            document.getElementById("rtAudienceRatingsCount").innerHTML = data.audienceScore.ratingCount;
        }
    }
    else{
        // If the data object does not exist, update the score panel with "An error occurred"
        document.getElementById("rtTitle").innerHTML = "ERROR";
        document.getElementById("rtCriticsConsensus").innerHTML = "An error occurred.";
    }
}



// Set the URL of the movie or TV series on scorepanel elements
function setHref(url){
    document.getElementById("rtLink").setAttribute("href", url);
    document.getElementById("rtCriticLink").setAttribute("href", url + "#contentReviews");
    document.getElementById("rtAudienceLink").setAttribute("href", url + "#audience_reviews");
}



// Add CSS styles to the page
function addCSS(){
    // Create a new style element
    var style = document.createElement("style");
    // Set the CSS styles for the score panel
    var css = document.createTextNode(`

        #rtScorePanel {
            display: grid;
            grid-template-columns: 1fr 1fr;
        }

        #rtHeader {
            grid-column-start: 1;
            grid-column-end: 3;
        }

        #rtTitle {
            text-align: center;
            font-family: 'franklin gothic medium';
            font-weight: 400;
            text-transform: uppercase;
        }

        #rtCriticsConsensus {
            grid-column-start: 1;
            grid-column-end: 3;

            text-align: center;
            padding: 5px;
            min-height: 60px;
        }

        .rtCriticScore {
            text-align: right;
            padding: 0 20px 0 10px;
        }

        .rtAudienceScore {
            text-align: left;
            padding: 0 0 10px 20px;
        }

        #rtLink, #rtCriticLink, #rtAudienceLink{
            text-decoration: none !important;
            color: #F5F5F5;
        }

        .icon{
            height: 48px;
            width: 48px;
            display: inline-block;
            vertical-align: middle;
        }

        .certified-fresh, .certified_fresh{
            background: url(https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/cf-lg.3c29eff04f2.png) no-repeat;
            background-size: cover;
            
        }

        .fresh{
            background: url(https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-fresh-lg.12e316e31d2.png) no-repeat;
            background-size: cover;
        }

        .rotten{
            background: url(https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-rotten-lg.ecdfcf9596f.png) no-repeat;
            background-size: cover;
        }

        .upright{
            background: url(https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-upright.ac91cc241ac.png) no-repeat;
            background-size: cover;
        }

        .spilled{
            background: url(https://www.rottentomatoes.com/assets/pizza-pie/images/icons/global/new-spilled.844ba7ac3d0.png) no-repeat;
            background-size: cover;
        }

        .rtPercent{
            font-size: 30px;
            font-weight: bold;
            margin-top: 5px;
            text-align: left;
        }

        .rticon, .rtPercent{
            display: inline-block;
            vertical-align: middle;
        }

        .rtRatingsTotals{
            margin-top: 20px;
        }

        .rtCriticNotAvailable, .rtAudienceNotAvailable{
            font-size: 14px;
            color: #999;
            font-weight: 500;
            font-family: 'Franklin Gothic FS Med',sans-serif;
        }

        .rtCriticNotAvailable{
            text-align: right;
            line-height: 1.2;
            //padding: 20px 0 5px;
        }


        .rtAudienceNotAvailable{
            text-align: left;
            font-style: italic;
            margin: 0;
            //font-family: 'Franklin Gothic FS Book',sans-serif;
            line-height: 20px;
        }

        .rtH3{
            font-family: 'Franklin Gothic Medium',sans-serif;
            line-height: 17px;
            color: #FAFAFA;
            margin: 0 0 12px;
            font-size: 14px;
            font-weight: 700;
        }

        .rtRatingsSmallText{
            font-size: 14px;
            font-family: 'Franklin Gothic Medium',sans-serif;
            font-weight: 400;
            color: #F5F5F5;
        }
        `
    );

    style.appendChild(css);
    document.getElementsByTagName("head")[0].appendChild(style);
}