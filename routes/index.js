/*
 * Connect all of your endpoints together here.
 */
var h = require('./helpers.js');

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api', require('./users.js')(router));
    app.use('/api', require('./tasks.js')(router));

    // Unknown endpoints
    app.use(function (req, res) {
        h.send(res, 404, 'Endpoint not found', 'No endpoint matches ' + req.method + ' ' + req.path);
    });

    // Malformed request bodies and anything else that escaped a route
    app.use(function (err, req, res, next) {
        if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
            return h.send(res, 400, 'Invalid request body', 'The request body could not be parsed');
        }
        h.handleError(res, err);
    });
};
