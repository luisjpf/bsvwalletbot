const MongoClient = require("mongodb").MongoClient;
const config = require("./config");
const ObjectId = require('mongodb').ObjectID;

const db = {
    addresses:{
        getAddressesByTgid: async (tgid) => {
            let result = await findMany(config.mongodb.collections.addresses, {tgid});
            return result;
        },
        addAddress: async (addr) => {
            let result = await insertOne(config.mongodb.collections.addresses, addr);
            return result;
        },
        getAddressByKey: async (keyString) => {
            let result = await findOne(config.mongodb.collections.addresses, {key: keyString});
            return result;
        },
        transferAddrOwner: async(keyString, newOwnerTgid) => {
            return new Promise((resolve, reject) => {
                updateOne(config.mongodb.collections.addresses,{key:keyString},{
                    tgid: newOwnerTgid
                }).then((res) => {
                    resolve(res);
                }).catch(err => {
                    reject(err);
                })
            })
        }
    }

};


const insertOne = (collection, doc) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).insertOne(doc, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                })

                client.close();
            }
        })
    })
}

const insertMany = (collection, docs) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).insertMany(docs, (err, result) => {
                    if (err) {
                        reject(new Error(2));
                    } else {
                        resolve(result);
                    }
                })

                client.close();
            }
        })
    })
}

const findOne = (collection, filter) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).findOne(filter, (err, result) => {
                    if (err) {
                        reject(new Error(2));
                    } else {
                        resolve(result);
                    }
                })

                client.close();
            }
        })
    })
}

const findMany = (collection, filter) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).find(filter).toArray((err, results) => {
                    if (err) reject(new Error(1));
                    else
                        resolve(results);
                })

                client.close();
            }
        })
    })

}

const updateOne = (collection, filter, update, upsert = false) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).updateOne(filter, update, (err, result) => {
                    if (err) reject(new Error(2));
                    else resolve(result);
                })

                client.close();
            }
        })
    })
}

const deleteOne = (collection, filter) => {
    return new Promise((resolve, reject) => {
        MongoClient.connect(config.mongodb.uri, (err, client) => {
            if (err) {
                reject(new Error(1));
            } else {
                client.db(config.mongodb.dbname).collection(collection).deleteOne(filter, (err, result) => {
                    if (err) reject(new Error(2));
                    else resolve(result);
                })

                client.close();
            }
        })
    })
}

module.exports = db;