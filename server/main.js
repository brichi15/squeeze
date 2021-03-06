const express = require('express');
const bodyParser = require('body-parser');  
const Request = require("request");
const scheduleHelper = require("./scheduleHelper.js");
const moment = require("moment");
const sendHelper = require('./sendHelper.js')
let arr = []

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));  
app.use(bodyParser.json());
const port = process.env.PORT || 4000;

var fs = require("fs");

const {google} = require('googleapis')

var content = fs.readFileSync("../client_id.json");
var credentialsJson = JSON.parse(content);

const googleConfig = {
    clientId: credentialsJson.web.client_id, // e.g. asdfghjkljhgfdsghjk.apps.googleusercontent.com
    clientSecret: credentialsJson.web.client_secret, // e.g. _ASDFA%DFASDFASDFASD#FAD-
    redirect: credentialsJson.web.redirect_uris[0] // this must match your google api settings
};

/**
 * Create the google auth object which gives us access to talk to google's apis.
 */
function createConnection() {
    return new google.auth.OAuth2(
        googleConfig.clientId,
        googleConfig.clientSecret,
        googleConfig.redirect
    );
}


/**
 * This scope tells google what information we want to request.
 */
const defaultScope = [
    'https://www.googleapis.com/auth/plus.me',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.readonly'
];

/**
 * Get a url which will open the google sign-in page and request access to the scope provided (such as calendar events).
 */
function getConnectionUrl(auth) {
    return auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // access type and approval prompt will force a new refresh token to be made each time signs in
        scope: defaultScope
    });
}

  /**
 * Create the google url to be sent to the client.
 */
function urlGoogle() {
    const auth = createConnection(); // this is from previous step
    const url = getConnectionUrl(auth);
    return url;
}

function getGooglePlusApi(auth) {
    return google.plus({ version: 'v1', auth });
  }

function sendEvent(auth, req, callbackFn) {
    var event = {
    'summary': 'Squeeze Meet',
    'location': req.query.locationName,
    'attendees':[
        {'email':req.query.toEmail}
    ],
    'colorId': "3",
    'start': {
        'dateTime': req.query.startTime,
        'timeZone': 'America/New_York'
    },
        'end': {
            'dateTime': req.query.endTime,
            'timeZone': 'America/New_York'
        },

    };

    const calendar = google.calendar({version:'v3', auth});

    calendar.events.insert({
        auth: auth,
        calendarId: 'primary',
        resource: event,
        //colorId: {kind
        //}
        }, function(err, event) {
        if (err) {
            console.log('There was an error contacting the Calendar service: ' + err);
            return;
        }
        console.log(event);
        //get events after sending
        if(callbackFn){
            callbackFn(auth)
        }
    });
}

function getEvents(auth, callbackFn){
    //start at today midnight
    const timeMin = moment().format('YYYY-MM-DD') + "T00:00:00-05:00"
    //end seven days from now
    const timeMax = moment().add(6, 'days').format('YYYY-MM-DD') + "T23:59:00-05:00"
   var read = {
       "timeMin": timeMin,
       "timeMax": timeMax,
       'timeZone': 'America/New_York',
       "groupExpansionMax": 2,
       "calendarExpansionMax": 2,
       "items": [
           {
               "id": "primary"
           }
       ]
    };
   const calendar = google.calendar({version:'v3', auth});
   calendar.freebusy.query({
       auth: auth,
       resource: read,
       }, function(err, res) {
       if (err) {
           console.log('There was an error contacting the Calendar service: ' + err);
           return;
       }
       else{
            const freeTimes = scheduleHelper.processSchedule(res.data.calendars.primary.busy);
            callbackFn(freeTimes);
       }
   });
}

/**
 * Part 2: Take the "code" parameter which Google gives us once when the user logs in, then get the user's email and id.
 */
async function getGoogleAccountFromCode(code, callbackFn) {
    const auth = createConnection();
    const data = await auth.getToken(code);
    const tokens = data.tokens;
    auth.setCredentials(tokens);
    const plus = getGooglePlusApi(auth);
    const me = await plus.people.get({ userId: 'me' });
    const userGoogleId = me.data.id;
    const userGoogleEmail = me.data.emails && me.data.emails.length && me.data.emails[0].value;

    getEvents(auth, (times) => {
        const returnObj = {
            freeTimes: times,
            id: userGoogleId,
            email: userGoogleEmail,
            token: tokens
        }
        callbackFn(returnObj);
    });
  }

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
})

app.get('/api/submit',(req,res)=>{
    console.log(req.query)
    const url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" + req.query.lat + "," + req.query.lng + "&radius=1500&type=" + req.query.type + "&keyword=" + req.query.keyword + "&key=AIzaSyDjsHLqGWCTqiZBRLDKgBsbcyOn9aoUTEk"
    console.log(url)
    Request.get(url, async (error, response, body) =>{
        if(error){
            return console.log(error)
        } 
        arr = await sendHelper.parseMapData(body);
        console.log(arr[1])
        res.send({'locationName': arr[1]})
    })
})

app.get('/api/accept',(req, res)=>{
    const auth = createConnection();
    const tokens = req.query.token;
    auth.setCredentials({access_token: tokens});
    console.log(req.query);
    sendEvent(auth, req, function(auth){
        getEvents(auth, (times) => {
            console.log(times);
            res.send({"freeTimes": times});
        });
    });
})

//app.get('/api/accept')

app.get('/api/test', (req, res) => {
  res.send({ "hi": 'Hello From Express' });
});

app.get('/api/signIn', (req, res) => {
    const url = urlGoogle();
    res.send({'url': url});
});

app.get('/api/signInInfo', async (req, res) => {
    const code = req.query.code;
    getGoogleAccountFromCode(code, function(info){
        console.log(info);
        res.send({'info': info});
    });
});

app.listen(port, () => console.log(`Listening on port ${port}`));