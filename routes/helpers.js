/*
 * Shared helpers for the users and tasks endpoints.
 */
var mongoose = require('mongoose');

// An error that already carries the HTTP status and a client-safe message
function HttpError(status, message, data) {
    this.status = status;
    this.message = message;
    this.data = data === undefined ? null : data;
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data === undefined ? null : data });
}

function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Errors raised by MongoDB/Mongoose while running a query built from user input
function isQueryInputError(err) {
    if (!err) return false;
    if (err.name === 'CastError' || err.name === 'StrictModeError' || err.name === 'ValidationError') return true;
    // MongoServerError here means the server rejected the query itself (bad operator, bad projection, ...)
    return err.name === 'MongoServerError' && err.code !== 11000;
}

// Turn any error into a JSON response without leaking database internals
function handleError(res, err) {
    if (err instanceof HttpError) {
        return send(res, err.status, err.message, err.data);
    }
    if (err && err.code === 11000) {
        return send(res, 400, 'A user with this email already exists', null);
    }
    console.error(err);
    send(res, 500, 'Internal server error', 'Something went wrong on the server, please try again later');
}

// Parse a JSON-encoded query string parameter; undefined when absent
function parseJSONParam(query, name) {
    var raw = query[name];
    if (raw === undefined || raw === '') return undefined;
    if (typeof raw !== 'string') {
        throw new HttpError(400, 'Invalid "' + name + '" parameter', 'The "' + name + '" parameter must be given once, as JSON');
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new HttpError(400, 'Invalid "' + name + '" parameter', 'The "' + name + '" parameter must be valid JSON');
    }
}

function parseObjectParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, 'Invalid "' + name + '" parameter', 'The "' + name + '" parameter must be a JSON object');
    }
    return value;
}

function parseIntParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new HttpError(400, 'Invalid "' + name + '" parameter', 'The "' + name + '" parameter must be a non-negative integer');
    }
    return value;
}

function parseBoolParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
        throw new HttpError(400, 'Invalid "' + name + '" parameter', 'The "' + name + '" parameter must be true or false');
    }
    return value;
}

/*
 * GET on a collection: where, sort, select, skip, limit, count.
 * All filtering is done by MongoDB through Mongoose.
 */
async function listDocuments(Model, query, defaultLimit) {
    var where = parseObjectParam(query, 'where') || {};
    var sort = parseObjectParam(query, 'sort');
    var select = parseObjectParam(query, 'select');
    var skip = parseIntParam(query, 'skip');
    var limit = parseIntParam(query, 'limit');
    var count = parseBoolParam(query, 'count');

    try {
        if (count) {
            var options = {};
            if (skip !== undefined) options.skip = skip;
            if (limit !== undefined && limit > 0) options.limit = limit;
            return await Model.countDocuments(where, options);
        }

        var q = Model.find(where);
        if (sort) q = q.sort(sort);
        if (select) q = q.select(select);
        if (skip !== undefined) q = q.skip(skip);
        if (limit === undefined) limit = defaultLimit;
        if (limit !== undefined) q = q.limit(limit);
        return await q.exec();
    } catch (err) {
        if (isQueryInputError(err)) {
            throw new HttpError(400, 'Invalid query parameters', 'The query could not be run with the given parameters');
        }
        throw err;
    }
}

// GET on a single resource: only "select" applies; unknown or malformed ids are 404
async function getDocument(Model, id, query, notFoundMessage) {
    var select = parseObjectParam(query, 'select');
    if (!isValidId(id)) throw new HttpError(404, notFoundMessage, null);

    var doc;
    try {
        var q = Model.findById(id);
        if (select) q = q.select(select);
        doc = await q.exec();
    } catch (err) {
        if (isQueryInputError(err)) {
            throw new HttpError(400, 'Invalid "select" parameter', 'The "select" parameter could not be applied');
        }
        throw err;
    }
    if (!doc) throw new HttpError(404, notFoundMessage, null);
    return doc;
}

// The request body as a plain object
function getBody(req) {
    var body = req.body;
    if (body === undefined || body === null) return {};
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Invalid request body', 'The request body must be a JSON object');
    }
    return body;
}

// URL-encoded forms send everything as strings, JSON bodies send real types
function isJSONRequest(req) {
    return !!req.is('application/json');
}

module.exports = {
    HttpError: HttpError,
    send: send,
    isValidId: isValidId,
    handleError: handleError,
    listDocuments: listDocuments,
    getDocument: getDocument,
    getBody: getBody,
    isJSONRequest: isJSONRequest,
    ObjectId: mongoose.Types.ObjectId
};
