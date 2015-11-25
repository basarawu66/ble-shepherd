var Datastore = require('nedb'),
    Q = require('q'),
    _ = require('lodash');

var db = new Datastore({ filename: '../lib//database/ble.db', autoload: true });

var bledb = {};

bledb.saveInfo = function (type, info, callback) {
    var self = this,
        deferred = Q.defer(),
        checkObj = {};

    if (type === 'device') {
        checkObj._id = info._id;
    } else if (type === 'service') {
        checkObj.owner = info.owner;
        checkObj.uuid = info.uuid;
    } else if (type === 'characteristic') {
        checkObj.ancestor = info.ancestor;
        checkObj.owner = info.owner;
        checkObj.uuid = info.uuid;
    }

    this.hasInDB(checkObj).then(function (result) {
        if (!result) {
            db.insert(info, function (err, doc) {
                if (!err) {
                    deferred.resolve(doc);
                } else {
                    deferred.reject(err);
                }
            });
        } else {
            deferred.resolve(info);
        }
    }).fail(function (err) {
        deferred.reject(err);
    }).done();

    return deferred.promise.nodeify(callback);
};

bledb.getInfo = function (type, callback) {
    var deferred = Q.defer(),
        queryObj,
        sortObj;

    if (type === 'device') {
        queryObj = {role: 'peripheral'};
        sortObj = {_id: 1};
    } else if (type === 'service') {
        queryObj = {owner: {$exists: true}, ancestor: {$exists: false}};
        sortObj = {uuid: 1};
    } else if (type === 'characteristic') {
        queryObj = {owner: {$exists: true}, ancestor: {$exists: true}};
        sortObj = {uuid: 1};
    } else {
        deferred.reject('type must be device or service or characteristic');
    }

    db.find(queryObj).sort(sortObj).exec(function (err, docs) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(docs);
        }
    });

    return deferred.promise.nodeify(callback);
};

bledb.update = function (id, updateObj, callback) {
    var deferred = Q.defer();

    db.update({ _id: id }, { $set: updateObj }, { multi: true }, function (err, numReplaced) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(numReplaced);
        }
    });
    return deferred.promise.nodeify(callback);
};

bledb.hasInDB = function (query, callback) { //TODO, public or private
    var deferred = Q.defer();

    db.findOne(query, function (err, doc) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(doc);
        }
    });

    return deferred.promise.nodeify(callback);
};

bledb.remove = function (type, id, callback) {
    var deferred = Q.defer(),
        rmvObj = {};

    if (type === 'device') {
        rmvObj['_id'] = id;
    } else if (type === 'service') {
        rmvObj['owner'] = id;
    } else if (type === 'characteristic') {
        rmvObj['ancestor'] = id;
    }

    db.remove(rmvObj, {multi: true}, function (err, numRemoved) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(numRemoved);
        }
    });

    return deferred.promise.nodeify(callback);
};

module.exports = bledb;