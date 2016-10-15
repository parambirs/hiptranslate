var http = require('request');
var cors = require('cors');
var uuid = require('uuid');
var url = require('url');

function makeRequest (options) {
  return new Promise(function (resolve, reject) {
    http(options, function (error, response, body) {
      if (error) {
        // console.log('make request error:', error);
        reject(error);
      } else {
        // console.log('make request body:', body);
        response.body = body;
        resolve(response);
      }
    });
  });
}

function getAccessToken() {
  return makeRequest({
    method: 'POST',
    uri: 'https://datamarket.accesscontrol.windows.net/v2/OAuth2-13',
    form: {
      scope: 'http://api.microsofttranslator.com',
      client_secret: process.env.CLIENT_SECRET,
      client_id: 'HipTranslate',
      grant_type: 'client_credentials'
    }
  }).then(function(response) {
    return JSON.parse(response.body).access_token;
  });
}

function translate(token, text, from, to) {
  var qs = {
    'text': text,
    'to': to
  };

  if(from) {
    qs['from'] = from;
  }

  return makeRequest({
    method: 'GET',
    uri: 'http://api.microsofttranslator.com/V2/Ajax.svc/Translate',
    qs: qs,
    auth: {
      bearer: token
    }
  }).then(function (response) {
    console.log('In translate', response.body);
    return response.body;
  });

}

// This is the heart of your HipChat Connect add-on. For more information,
// take a look at https://developer.atlassian.com/hipchat/tutorials/getting-started-with-atlassian-connect-express-node-js
module.exports = function (app, addon) {
  var hipchat = require('../lib/hipchat')(addon);

  // simple healthcheck
  app.get('/healthcheck', function (req, res) {
    res.send('OK');
  });

  // Root route. This route will serve the `addon.json` unless a homepage URL is
  // specified in `addon.json`.
  app.get('/',
    function (req, res) {
      // Use content-type negotiation to choose the best way to respond
      res.format({
        // If the request content-type is text-html, it will decide which to serve up
        'text/html': function () {
          var homepage = url.parse(addon.descriptor.links.homepage);
          if (homepage.hostname === req.hostname && homepage.path === req.path) {
            res.render('homepage', addon.descriptor);
          } else {
            res.redirect(addon.descriptor.links.homepage);
          }
        },
        // This logic is here to make sure that the `addon.json` is always
        // served up when requested by the host
        'application/json': function () {
          res.redirect('/atlassian-connect.json');
        }
      });
    }
    );

  // This is an example route that's used by the default for the configuration page
  // https://developer.atlassian.com/hipchat/guide/configuration-page
  app.get('/config',
    // Authenticates the request using the JWT token in the request
    addon.authenticate(),
    function (req, res) {
      // The `addon.authenticate()` middleware populates the following:
      // * req.clientInfo: useful information about the add-on client such as the
      //   clientKey, oauth info, and HipChat account info
      // * req.context: contains the context data accompanying the request like
      //   the roomId
      res.render('config', req.context);
    }
    );

  // Sample endpoint to send a card notification back into the chat room
  // See https://developer.atlassian.com/hipchat/guide/sending-messages
  app.post('/send_notification',
    addon.authenticate(),
    function (req, res) {
      var card = {
        "style": "link",
        "url": "https://www.hipchat.com",
        "id": uuid.v4(),
        "title": req.body.messageTitle,
        "description": "Great teams use HipChat: Group and private chat, file sharing, and integrations",
        "icon": {
          "url": "https://hipchat-public-m5.atlassian.com/assets/img/hipchat/bookmark-icons/favicon-192x192.png"
        }
      };
      var msg = '<b>' + card.title + '</b>: ' + card.description;
      var opts = { 'options': { 'color': 'yellow' } };
      hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts, card);
      res.json({ status: "ok" });
    }
    );

  // This is an example route to handle an incoming webhook
  // https://developer.atlassian.com/hipchat/guide/webhooks
  app.post('/webhook',
    addon.authenticate(),
    function (req, res) {
      const cmd = req.body.item.message.message;

      // Handle invalid commands
      // 1. Only /translate specified
      if (cmd.trim() === '/translate') {
        const html = `<b>Usage: </b><code>/translate [[from]:[to]] message</code><br>
        Examples:<br>
        <code>/translate नमस्कार</code> <i>(translate from auto-detected language to English)</i><br>
        <code>/translate :ru hello</code> <i>(translate from auto-detected language to Russian)</i><br>
        <code>/translate hi:ru नमस्कार</code> <i>(translate from Hindi to Russian)</i><br>`;
        console.log('html', html);

        const options = {
          options: {
            color: "red"
          }
        };

        hipchat.sendMessage(req.clientInfo, req.identity.roomId, html, options)
            .then(function (data) {
              res.sendStatus(200);
            }, function(err) {
              console.error(err);
            });
      } else {
          const fullCommand = cmd.substr(cmd.indexOf(" ") + 1, cmd.length - 1);

          console.log('fullCommand', fullCommand);

          const langs = fullCommand.slice(0, fullCommand.indexOf(' '));
          console.log('langs', langs);

          // if no from:to specified, default from => autodetect and to => english
          if (langs.indexOf(':') === -1) {
              sendTranslationResponse(req, res, fullCommand, undefined, 'en');
          } else {
              const splitlangs = langs.split(':');
              const from = splitlangs[0];
              const to = splitlangs[1] || 'en';
              console.log('from', from, 'to', to);

              const text = fullCommand.slice(langs.length + 1);
              console.log('text', text);

              sendTranslationResponse(req, res, text, from, to);
          }
      }
    }
  );

    function sendTranslationResponse(req, res, text, from, to) {
        'use strict';
        getAccessToken()
            .then(function(token) {
                // console.log('token:', token);
                return translate(token, text, from, to);
            })
            .then(function(message) {
                const html = `"${text}" => ${message}`;
                console.log('html', html);

                const options = {
                    options: {
                        color: "green"
                    }
                };

                hipchat.sendMessage(req.clientInfo, req.identity.roomId, html, options)
                    .then(function (data) {
                        res.sendStatus(200);
                    }, function(err) {
                        console.error(err);
                    });
            });
    }

  // Notify the room that the add-on was installed. To learn more about
  // Connect's install flow, check out:
  // https://developer.atlassian.com/hipchat/guide/installation-flow
  addon.on('installed', function (clientKey, clientInfo, req) {
    hipchat.sendMessage(clientInfo, req.body.roomId, 'The ' + addon.descriptor.name + ' add-on has been installed in this room');
  });

  // Clean up clients when uninstalled
  addon.on('uninstalled', function (id) {
    addon.settings.client.keys(id + ':*', function (err, rep) {
      rep.forEach(function (k) {
        addon.logger.info('Removing key:', k);
        addon.settings.client.del(k);
      });
    });
  });

};
