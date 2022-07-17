// ==UserScript==
// @name         Rotten Tomatoes on IMDB 2
// @author       Cozzy
// @namespace    http://tampermonkey.net/
// @version      2
// @description  22/07/17 - Add rotten tomatoes critic conesesus and scores to imdb
// @match        https://www.imdb.com/title/*
// @grant        GM_xmlhttpRequest
// @connect      rottentomatoes.com
// @run-at document-start
// ==/UserScript==

// Useful debug titles
// [Rec]²
// https://www.imdb.com/title/tt12971924/ - The Call, The Call, The Call of the Wild
// https://www.imdb.com/title/tt1395135 - Occult
// https://www.imdb.com/title/tt4935372/ - The Devil's Candy (IMDb 2015, RT 2016)
// https://www.imdb.com/title/tt0084488 - Permanent Vactation - Doesn't load


window.onload = main;


function main(){

    addCSS();

    const IMDB_APPEND = document.getElementsByClassName("sc-910a7330-5 jSGBUG")[0];
    const IMDB_APPEND_NOVIDEO = document.getElementsByClassName("sc-910a7330-9 cnGAIC")[0];

    if(getMediaType() != 2){
        var sp = createScorePanel();

        if(IMDB_APPEND){
            IMDB_APPEND.appendChild(sp);
            getRottenTomatoes(sp, getTitle());
        }
        else if (IMDB_APPEND_NOVIDEO){
            IMDB_APPEND_NOVIDEO.appendChild(sp);
            getRottenTomatoes(sp, getTitle());
        }
        else
        {
            console.log("Failed to attach score panel.")
        }
    }

}


function getTitle(){

    const meta = document.getElementsByTagName("meta");

    for(let i = 0; i < meta.length; i++){
        if(meta[i].getAttribute("property") === "og:title"){
            return meta[i].getAttribute("content").split(/\(.*\) - IMDb$/)[0];
        }
    }
}


function getMediaType(){

    `
        Return
        1 for tv movie
        2 for tv series
        0 for anything else
    `

    var type = document.getElementsByClassName("ipc-inline-list ipc-inline-list--show-dividers")[0].firstChild.innerHTML;

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


function createScorePanel(){
    panel = document.createElement("div");
    panel.setAttribute("id", "rtScorePanel");

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


function getRottenTomatoes(){

    // getRottenTomatoes(sp, title)
    // Takes a scorepanel object and title
    // GETs a search result for title + director, checks the results for a movie within y_threshold years.
    // If a result is found, calls getScores

    const y_threshold = 2;
    var year;
    var search_url;


    title = getTitle();
    title = title.replace(/& |\[|\]|"|:|, |-|\./g, "");                     //Strip special chars
    title = title.replace(/²/, "2");                                        //e.g. [Rec]²
    title = title.replace(/³/g, "3");                                       //e.g. Alien³
    title = title.replace(/ /g, "%20");                                     //Replace spaces with valid url encoding

    var search_url = "https://www.rottentomatoes.com/search?search=" + title;

    if(!getMediaType()){
        const director = (document.getElementsByClassName("ipc-metadata-list-item__list-content-item ipc-metadata-list-item__list-content-item--link")[0].innerHTML.replace(/ /g, "%20"))
        search_url += "%20" + director;
        year = parseInt(document.getElementsByClassName("sc-8c396aa2-1 WIUyh")[0].innerHTML);
    }
    else{
        year = parseInt(document.getElementsByClassName("sc-8c396aa2-1 WIUyh")[0].innerHTML.substring(0,4));
    }

    console.log("Requesting " + search_url);

    GM_xmlhttpRequest({
        method: "GET",
        url: search_url,
        onload: function(response){
            var parser = new DOMParser();
            var parsedPage = parser.parseFromString(response.responseText, "text/html");
            var results;

            if(!getMediaType() || getMediaType() == 1){
                results = parsedPage.getElementsByTagName("search-page-media-row");

                for(let i = 0; i < results.length; i++){

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


function getScores(url){

    GM_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function(response){
            var parser = new DOMParser();
            var parsedPage = parser.parseFromString(response.responseText, "text/html");

            var scoreJSON = (JSON.parse(parsedPage.getElementById("score-details-json").innerHTML)).scoreboard;

            if(scoreJSON){
                if(parsedPage.getElementsByClassName("what-to-know__section-body")[0]){
                    scoreJSON.consensus = parsedPage.getElementsByClassName("what-to-know__section-body")[0].children[0].innerHTML;
                }
                else{
                    scoreJSON.consensus = "<em>No consensus.</em>"
                }
            }

            setHref(url);
            updatePanel(scoreJSON);

        }
    });
}


function updatePanel(data){

    if(data){
        document.getElementById("rtTitle").innerHTML = data.title;
        document.getElementById("rtCriticsConsensus").innerHTML = data.consensus;

        if(!data.tomatometerScore){
            document.getElementById("rtCriticPercent").innerHTML = "<div class='rtCriticNotAvailable'>Tomatometer <br> Not Yet Available</div>";
        }
        else{
            document.getElementById("rtCriticIcon").setAttribute("class", "icon " + data.tomatometerState);
            document.getElementById("rtCriticPercent").innerHTML = data.tomatometerScore + "%";
            document.getElementById("rtCriticRatingsCount").innerHTML = data.criticCount;
        }

        if(!data.audienceScore){
            document.getElementById("rtAudiencePercent").innerHTML = "<p class='rtAudienceNotAvailable'>Coming soon</p>";
            document.getElementById("rtAudienceRatingsCount").innerHTML = "Not yet available";
        }
        else{
            if(data.audienceState){
                document.getElementById("rtAudienceIcon").setAttribute("class", "icon " + data.audienceState);
            }
            document.getElementById("rtAudiencePercent").innerHTML = data.audienceScore + "%";
            document.getElementById("rtAudienceRatingsCount").innerHTML = data.audienceCount;
        }
    }
    else{
        this.set_title("ERROR");
        this.set_consensus("An error occurred.");
    }
}


function setHref(url){
    document.getElementById("rtLink").setAttribute("href", url);

    document.getElementById("rtCriticLink").setAttribute("href", url + "#contentReviews");
    document.getElementById("rtAudienceLink").setAttribute("href", url + "#audience_reviews");
}


function addCSS(){
    var style = document.createElement("style");
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