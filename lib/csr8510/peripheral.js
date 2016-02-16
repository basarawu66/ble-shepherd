var Q = require('q'),
    _ = require('lodash');

var bledb = require('./bledb'),
    charDiscrim = require('./characteristic/HciCharDiscriminator'),
    charBuild = require('./characteristic/HciCharBuilder'),
    bleutil = require('../util/bleutil'),
    GATTDEFS = require('../defs/gattdefs');
/*************************************************************************************************/
/*** Peripheral                                                                                ***/
/*************************************************************************************************/
function Peripheral (peripheral) {
    var self = this,
        servUuid;

    this._original = peripheral;
    this._id = null;
    
    this.role = 'peripheral';
    this.addr = '0x' + peripheral.id;
    this.addrType = peripheral.addressType;
    this.state = 'disc';
    this.connHdl = peripheral._noble._bindings._handles[peripheral.id];
    this.linkParams = null;
    this.servs = {};
    
    this.attachServices = function () {
        _.forEach(this._original.services, function (service) {
            var newService = new Service(service);
            newService.ownerDev = self;
            if ( newService.uuid.length ===  34) {
                servUuid = '0x' + newService.uuid.slice(6, 10);
            } else {
                servUuid = newService.uuid;
            }
            self.servs[servUuid] = newService;
        });
    };
}

Peripheral.prototype.connect = function (callback) {
    var deferred = Q.defer();
    
    this._original.connect(function (err) {
        if (_.isFunction(callback)) { callback(err); }
    });
};

Peripheral.prototype.disconnect = function (callback) {
    this._original.disconnect(function (err) {
        if (_.isFunction(callback)) { callback(err); }
    });
};

Peripheral.prototype.remove = function (callback) {
    var peripheral = this._original;

    peripheral.disconnect(function (err) {
        if (err) {
            if (_.isFunction(callback)) { callback(err); }            
        } else {
            bledb.remove('peripheral', peripheral).then(function () {
                peripheral.state = 'discovered';
                if (_.isFunction(callback)) { callback(null); }
            }).fail(function (err) {
                if (_.isFunction(callback)) { callback(err); }
            }).done();
        }
    });
};

Peripheral.prototype.updateLinkParam = function (interval, latency, timeout, callback) {
    var self = this;

    if (!_.isNumber(interval) || !_.isNumber(latency) || !_.isNumber(timeout)) {
        throw new Error('interval, latency and timeout must be number.');
    } else {
        this._original.updateLinkParam(interval, latency, timeout, function (err) {
            if (!err) {
                self.linkParams = {
                    interval: interval,
                    latency: latency,
                    timeout: timeout
                };
            }

            if (_.isFunction(callback)) { callback(err); }
        });
    }
};

Peripheral.prototype.discServsAndChars = function (updateFlag) {
    var self = this,
        deferred = Q.defer(),
        timeout,
        cmdName,
        operateCharFuncs = [];    

    if (updateFlag) {
        cmdName = 'update';
    } else {
        cmdName = 'read';
    }

    timeout = setTimeout(function () {
        if (deferred.promise.isPending()) {
            deferred.reject(new Error('discover services and characteristics timeout.'));
        }
    }, 2000);

    this._original.discoverAllServicesAndCharacteristics(function (error, servs, chars) {
        clearTimeout(timeout);
        if (error) {
            deferred.reject(error);
        } else {
            self.attachServices();
            _.forEach(self.servs, function (serv) {
                _.forEach(serv.chars, function (char) {
                    if (_.includes(char.prop, 'read')) {
                        operateCharFuncs.push(function () {
                            return char[cmdName]();
                        });
                    }
                });
            });
            bleutil.seqResolveQFuncs(operateCharFuncs).then(function () {
                deferred.resolve();
            }).fail(function (err) {
                deferred.reject(err);
            }).done();
        }
    });

    return deferred.promise;
};

Peripheral.prototype.save = function () {
    var deferred = Q.defer(),
        peripheral = this._original,
        servs = peripheral.services,
        chars = [],
        saveServFuncs = [],
        saveCharFuncs = [];

    _.forEach(servs, function (serv) {
        saveServFuncs.push(function () {
            return bledb.saveInfo('service', serv);
        });
        chars = chars.concat(serv.characteristics);
    });
    _.forEach(chars, function (char) {
        saveCharFuncs.push(function () {
            return bledb.saveInfo('characteristic', char);
        });
    });

    bledb.saveInfo('peripheral', peripheral).then(function () {
        return bleutil.seqResolveQFuncs(saveServFuncs);
    }).then(function () {
        return bleutil.seqResolveQFuncs(saveCharFuncs);
    }).then(function () {
        deferred.resolve();
    }).fail(function (err) {
        deferred.reject(err);
    }).done();

    return deferred.promise;
};

Peripheral.prototype.update = function (callback) {
    var updateFuncs = [];

    _.forEach(this.servs, function (serv) {
        _.forEach(serv.chars, function (char) {
            updateFuncs.push(function () {
                return char.update();
            });
        });
    });

    bleutil.seqResolveQFuncs(updateFuncs).then(function () {
        if (_.isFunction(callback)) { callback(null); }
    }).fail(function (err) {
        if (_.isFunction(callback)) { callback(err); }
    }).done();
};

Peripheral.prototype.findChar = function (uuidServ, uuidChar) {
    var serv;

    if (!_.isString(uuidServ) || !_.startsWith(uuidServ, '0x')) {
        throw new TypeError('uuidServ must be a string and start with 0x');
    } else if (!_.isString(uuidChar) || !_.startsWith(uuidChar, '0x')) {
        throw new TypeError('uuidChar must be a string and start with 0x');
    }

    if (this.servs[uuidServ]) { serv = this.servs[uuidServ]; }
    if (serv) {
        return serv.chars[uuidChar];
    } else {
        return;
    }
};

Peripheral.prototype.read = function (uuidServ, uuidChar, callback) {
    var char = this.findChar(uuidServ, uuidChar);

    if (!_.isFunction (callback)) {
        throw new TypeError('callback must be a function');
    } else if (!char) {
        callback(new Error('No corresponding characteristic.'));
    } else {
        char.read().then(function (data) {
            callback(null, data);
        }).fail(function (err) {
            callback(err);
        }).done();
    }
};

Peripheral.prototype.readDesc = function (uuidServ, uuidChar, callback) {
    var char = this.findChar(uuidServ, uuidChar);

    if (!_.isFunction (callback)) {
        throw new TypeError('callback must be a function');
    } else if (!char) {
        callback(new Error('No corresponding characteristic.'));
    } else {
        char.readDesc().then(function (data) {
            callback(null, data);
        }).fail(function (err) {
            callback(err);
        }).done();
    }
};

Peripheral.prototype.write = function (uuidServ, uuidChar, data, callback) {
    var char = this.findChar(uuidServ, uuidChar);

    if (!char) {
        if (_.isFunction(callback)) { callback(new Error('No corresponding characteristic.')); }
    } else {
        char.write(data).then(function () {
            if (_.isFunction(callback)) { callback(null); }
        }).fail(function (err) {
            if (_.isFunction(callback)) { callback(err); }
        }).done();
    }
};

Peripheral.prototype.setNotify = function (uuidServ, uuidChar, config, callback) {
    var char = this.findChar(uuidServ, uuidChar),
        originalChar = char._original,
        checkErr;

    if (!char) {
        if (_.isFunction(callback)) { callback(new Error('No corresponding characteristic.')); }
    } else {
        originalChar.notify(config, function (err) {
            if (_.isFunction(callback)) { callback(err); }
        });
    }
};

Peripheral.prototype.regCharHdlr = function (uuidServ, uuidChar, hdlr) {
    var char = this.findChar(uuidServ, uuidChar);

    if (!_.isFunction(hdlr)) { throw new TypeError('fn must be a function'); }
    
    if (char) {
        char.processInd = hdlr;
    }

    return this;
};
/*************************************************************************************************/
/*** Service                                                                                   ***/
/*************************************************************************************************/
function Service (serv) {
    var self = this,
        charUuid;

    this._original = serv;
    this._id = null;

    this.ownerDev = null;
    this.uuid = '0x' + serv.uuid;
    this.startHdl = serv._noble._bindings._gatts[serv._peripheralId]._services[serv.uuid].startHandle;
    this.endHdl = serv._noble._bindings._gatts[serv._peripheralId]._services[serv.uuid].endHandle;
    this.name = null;
    this.chars = {};

    if (GATTDEFS.ServUuid.get(_.parseInt(this.uuid))) { 
        this.name = GATTDEFS.ServUuid.get(_.parseInt(this.uuid)).key; 
    }

    _.forEach(serv.characteristics, function (characteristic) {
        var newCharacteristic = new Characteristic(characteristic);
        newCharacteristic.ownerServ = self;
        if ( newCharacteristic.uuid.length ===  34) {
            charUuid = '0x' + newCharacteristic.uuid.slice(6, 10);
        } else {
            charUuid = newCharacteristic.uuid;
        }
        self.chars[charUuid] = newCharacteristic;
    });
}

/*************************************************************************************************/
/*** Characteristic                                                                            ***/
/*************************************************************************************************/
function Characteristic (char) {
    var self = this;

    this._original = char;
    this._id = null;
    this._authState = null;

    this.ownerServ = null;
    this.uuid = '0x' + char.uuid;
    this.hdl = null;
    this.prop = char.properties;
    this.desc = char._noble._bindings._gatts[char._peripheralId]._characteristics[char._serviceUuid][char.uuid].valueHandle;
    this.name = null;
    this.val = char.value;

    this.processInd = function () {};

    if (GATTDEFS.CharUuid.get(_.parseInt(this.uuid))) { 
        this.name = GATTDEFS.CharUuid.get(_.parseInt(this.uuid)).key;
    }

    this._original.on('data', function (data, isNotification) {
        if (isNotification) {
            self.discrimChar(data).done(function (result) {
                self.val = self._original.value = result;
                self.processInd(result);
                bledb.update('characteristic', self._original).done();
            });
        }
    });
}

Characteristic.prototype.buildChar = function () {
    return charBuild(originalChar.uuid).transToValObj(data).getHciCharBuf();
};

Characteristic.prototype.discrimChar = function (data) {
    var deferred = Q.defer(),
        uuid = this.uuid;

    if (uuid.length === 34) { uuid =  '0x' + uuid.slice(6, 10);}

    charDiscrim(uuid).getCharValPacket(data)
    .then(function (result) {
        deferred.resolve(result);
    }).fail(function (err) {
        deferred.reject(err);
    }).done();

    return deferred.promise;
};

Characteristic.prototype.read = function () {
    var self = this,
        deferred = Q.defer();

    this._original.read(function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            self.discrimChar(data).then(function (result) {
                self.val = self._original.value = result;
                deferred.resolve(result);
            }).fail(function (err) {
                deferred.reject(err);
            }).done();
        }
    });

    return deferred.promise;
};

Characteristic.prototype.readDesc = function () {
    var self = this,
        deferred = Q.defer();

    this._original.readDesc(function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            charDiscrim('0x2901').getCharValPacket(data)
            .then(function (result) {
                deferred.resolve(result);
            }).fail(function (err) {
                deferred.reject(err);
            }).done();
        }
    });

    return deferred.promise;
};

Characteristic.prototype.write = function (data, callback) {
    var self = this,
        deferred = Q.defer();

    dataBuf = this.buildChar(data);
    this._original.write(dataBuf, false, function (err) {
        if (err) {
            deferred.reject(err);
        } else {
            self.val = self._original.value = result;
            deferred.resolve();
        }
    });

    return deferred.promise;
};

Characteristic.prototype.update = function (callback) {
    var self = this,
        deferred = Q.defer(),
        oldVal = this.val;

    if (_.includes(this.prop, 'read')) {
        this.read().then(function () {
            if (!_.isEqual(oldVal, self.val)) {
                return bledb.update('characteristic', self._original);
            } else {
                return;
            }
        }).then(function () {
            deferred.resolve();
        }).fail(function (err) {
            deferred.reject(err);
        }).done();
    } else {
        deferred.resolve();
    }

    return deferred.promise;
};

module.exports = Peripheral;