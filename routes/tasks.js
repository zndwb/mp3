var User = require('../models/user.js');
var Task = require('../models/task.js');
var h = require('./helpers.js');

var HttpError = h.HttpError;
var NOT_FOUND = 'Task not found';

function wrongType(field, expected) {
    return new HttpError(400, 'Invalid ' + field, 'The "' + field + '" field must be ' + expected);
}

function parseDeadline(value) {
    if (value === undefined || value === null || value === '') {
        throw new HttpError(400, 'A task needs a deadline', 'The "deadline" field is required');
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) value = Number(value);
    if (typeof value !== 'string' && typeof value !== 'number') throw wrongType('deadline', 'a date');
    var date = new Date(value);
    if (isNaN(date.getTime())) throw wrongType('deadline', 'a valid date');
    return date;
}

function parseCompleted(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw wrongType('completed', 'true or false');
}

/*
 * Validate a POST/PUT body and check the referenced user.
 * Nothing is written here, so a failed request leaves the database untouched.
 */
async function validateTask(req) {
    var body = h.getBody(req);

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new HttpError(400, 'A task needs a name', 'The "name" field is required and must be a non-empty string');
    }
    var deadline = parseDeadline(body.deadline);

    var description = body.description;
    if (description === undefined || description === null) description = '';
    if (typeof description !== 'string') throw wrongType('description', 'a string');

    var completed = parseCompleted(body.completed);

    var assignedUser = body.assignedUser;
    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string') throw wrongType('assignedUser', 'a user id');
    if (assignedUser !== '' && !h.isValidId(assignedUser)) {
        throw new HttpError(400, 'Invalid assignedUser', '"' + assignedUser + '" is not a valid user id');
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName === null) assignedUserName = undefined;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') throw wrongType('assignedUserName', 'a string');

    if (assignedUser === '') {
        if (assignedUserName !== undefined && assignedUserName !== '' && assignedUserName !== 'unassigned') {
            throw new HttpError(400, 'assignedUserName does not match assignedUser',
                'An unassigned task must have assignedUserName "unassigned"');
        }
        assignedUserName = 'unassigned';
    } else {
        assignedUser = assignedUser.toLowerCase();
        var user = await User.findById(assignedUser).select('name');
        if (!user) throw new HttpError(404, 'User not found', 'No user exists with id ' + assignedUser);
        if (assignedUserName !== undefined && assignedUserName !== user.name) {
            throw new HttpError(400, 'assignedUserName does not match assignedUser',
                'User ' + assignedUser + ' is named "' + user.name + '", not "' + assignedUserName + '"');
        }
        assignedUserName = user.name;
    }

    return {
        name: body.name,
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

/*
 * Make the users agree with the task: only its assigned user may list it
 * in pendingTasks, and only while it is not completed.
 */
async function syncUsers(task) {
    var id = String(task._id);
    var owner = task.assignedUser;

    await User.updateMany({ pendingTasks: id }, { $pull: { pendingTasks: id } });
    if (owner && !task.completed) {
        await User.updateOne({ _id: owner }, { $addToSet: { pendingTasks: id } });
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(async function (req, res) {
        try {
            var data = await h.listDocuments(Task, req.query, 100);
            h.send(res, 200, 'OK', data);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    tasksRoute.post(async function (req, res) {
        try {
            var fields = await validateTask(req);
            var task = await Task.create(fields);
            await syncUsers(task);
            h.send(res, 201, 'Task created', task);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(async function (req, res) {
        try {
            var task = await h.getDocument(Task, req.params.id, req.query, NOT_FOUND);
            h.send(res, 200, 'OK', task);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    taskRoute.put(async function (req, res) {
        try {
            var id = req.params.id;
            var task = h.isValidId(id) ? await Task.findById(id) : null;
            if (!task) throw new HttpError(404, NOT_FOUND, null);

            var fields = await validateTask(req);
            task.set(fields);
            await task.save();
            await syncUsers(task);
            h.send(res, 200, 'Task updated', task);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    taskRoute.delete(async function (req, res) {
        try {
            var id = req.params.id;
            var task = h.isValidId(id) ? await Task.findById(id) : null;
            if (!task) throw new HttpError(404, NOT_FOUND, null);

            await User.updateMany({ pendingTasks: String(task._id) }, { $pull: { pendingTasks: String(task._id) } });
            await Task.deleteOne({ _id: task._id });
            h.send(res, 200, 'Task deleted', task);
        } catch (err) {
            h.handleError(res, err);
        }
    });

    return router;
};
