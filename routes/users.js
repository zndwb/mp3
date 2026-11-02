var User = require('../models/user.js');
var Task = require('../models/task.js');
var h = require('./helpers.js');

var HttpError = h.HttpError;
var NOT_FOUND = 'User not found';

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

/*
 * Validate a POST/PUT body and check the referenced tasks.
 * Nothing is written here, so a failed request leaves the database untouched.
 * userId is the user being replaced (undefined for POST).
 */
async function validateUser(req, userId) {
    var body = h.getBody(req);

    if (!isNonEmptyString(body.name)) {
        throw new HttpError(400, 'A user needs a name', 'The "name" field is required and must be a non-empty string');
    }
    if (!isNonEmptyString(body.email)) {
        throw new HttpError(400, 'A user needs an email', 'The "email" field is required and must be a non-empty string');
    }
    var email = body.email.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Invalid email address', 'The "email" field must be a valid email address');
    }

    var pendingTasks = body.pendingTasks;
    if (pendingTasks === undefined || pendingTasks === null) {
        pendingTasks = [];
    } else if (typeof pendingTasks === 'string' && !h.isJSONRequest(req)) {
        // a single value from a URL-encoded form
        pendingTasks = pendingTasks === '' ? [] : [pendingTasks];
    }
    if (!Array.isArray(pendingTasks)) {
        throw new HttpError(400, 'Invalid pendingTasks', 'The "pendingTasks" field must be a list of task ids');
    }
    for (var i = 0; i < pendingTasks.length; i++) {
        if (!h.isValidId(pendingTasks[i])) {
            throw new HttpError(400, 'Invalid task id in pendingTasks', '"' + String(pendingTasks[i]) + '" is not a valid task id');
        }
    }
    // the same task listed twice is still just one pending task
    pendingTasks = pendingTasks.map(function (id) { return id.toLowerCase(); })
        .filter(function (id, idx, arr) { return arr.indexOf(id) === idx; });

    var duplicate = await User.findOne({ email: email }).select('_id');
    if (duplicate && String(duplicate._id) !== String(userId)) {
        throw new HttpError(400, 'A user with this email already exists', 'The email "' + email + '" is already used by another user');
    }

    var tasks = await Task.find({ _id: { $in: pendingTasks } });
    if (tasks.length !== pendingTasks.length) {
        var found = tasks.map(function (t) { return String(t._id); });
        var missing = pendingTasks.filter(function (id) { return found.indexOf(id) === -1; });
        throw new HttpError(404, 'Task not found', 'No task exists with id ' + missing.join(', '));
    }
    for (var j = 0; j < tasks.length; j++) {
        if (tasks[j].completed) {
            throw new HttpError(400, 'Completed tasks cannot be pending', 'Task ' + tasks[j]._id + ' is already completed');
        }
    }

    return { name: body.name, email: email, pendingTasks: pendingTasks };
}

/*
 * Make the tasks agree with the user's pendingTasks:
 * listed tasks are assigned to the user (and taken away from anyone else),
 * the user's other pending tasks are unassigned, and the user's name is
 * copied to every task assigned to them.
 */
async function syncTasks(user) {
    var id = String(user._id);
    var pending = user.pendingTasks;

    await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: pending } },
        { $pull: { pendingTasks: { $in: pending } } });
    await Task.updateMany({ assignedUser: id, completed: false, _id: { $nin: pending } },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
    await Task.updateMany({ $or: [{ _id: { $in: pending } }, { assignedUser: id }] },
        { $set: { assignedUser: id, assignedUserName: user.name } });
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    usersRoute.get(async function (req, res) {
        try {
            var data = await h.listDocuments(User, req.query);
            h.send(res, 200, 'OK', data);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    usersRoute.post(async function (req, res) {
        try {
            var fields = await validateUser(req);
            var user = await User.create(fields);
            await syncTasks(user);
            h.send(res, 201, 'User created', user);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    var userRoute = router.route('/users/:id');

    userRoute.get(async function (req, res) {
        try {
            var user = await h.getDocument(User, req.params.id, req.query, NOT_FOUND);
            h.send(res, 200, 'OK', user);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    userRoute.put(async function (req, res) {
        try {
            var id = req.params.id;
            var user = h.isValidId(id) ? await User.findById(id) : null;
            if (!user) throw new HttpError(404, NOT_FOUND, null);

            var fields = await validateUser(req, user._id);
            user.name = fields.name;
            user.email = fields.email;
            user.pendingTasks = fields.pendingTasks;
            await user.save();
            await syncTasks(user);
            h.send(res, 200, 'User updated', user);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    userRoute.delete(async function (req, res) {
        try {
            var id = req.params.id;
            var user = h.isValidId(id) ? await User.findById(id) : null;
            if (!user) throw new HttpError(404, NOT_FOUND, null);

            await Task.updateMany({ assignedUser: String(user._id) },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
            await User.deleteOne({ _id: user._id });
            h.send(res, 200, 'User deleted', user);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    return router;
};
