'use strict';

var A = module.exports;
var U = require('./utils.js');
var E = require('./errors.js');

var pending = {};

A._getOrCreate = function(gnlck, mconf, db, acme, args) {
    var email = args.subscriberEmail || mconf.subscriberEmail;

    if (!email) {
        throw E.NO_SUBSCRIBER('get account', args.subject);
    }

    // TODO send welcome message with benefit info
    return U._validMx(email)
        .catch(function() {
            throw E.NO_SUBSCRIBER('get account', args.subcriberEmail);
        })
        .then(function() {
            if (pending[email]) {
                return pending[email];
            }

            pending[email] = A._rawGetOrCreate(
                gnlck,
                mconf,
                db,
                acme,
                args,
                email
            )
                .catch(function(e) {
                    delete pending[email];
                    throw e;
                })
                .then(function(result) {
                    delete pending[email];
                    return result;
                });

            return pending[email];
        });
};

// What we really need out of this is the private key and the ACME "key" id
A._rawGetOrCreate = function(gnlck, mconf, db, acme, args, email) {
    return A._newAccount(gnlck, mconf, db, acme, args, email, null);
};

A._newAccount = function(gnlck, mconf, db, acme, args, email, fullAccount) {
    var keyType = args.accountKeyType || mconf.accountKeyType;
    var query = {
        subject: args.subject,
        email: email,
        subscriberEmail: email,
        customerEmail: args.customerEmail,
        account: fullAccount || {},
        directoryUrl:
            args.directoryUrl ||
            mconf.directoryUrl ||
            gnlck._defaults.directoryUrl
    };

    return U._getOrCreateKeypair(db, args.subject, query, keyType).then(
        function(kresult) {
            var keypair = kresult.keypair;
            var accReg = {
                subscriberEmail: email,
                agreeToTerms:
                    args.agreeToTerms ||
                    mconf.agreeToTerms ||
                    gnlck._defaults.agreeToTerms,
                accountKey: keypair.privateKeyJwk || keypair.private,
                debug: args.debug
            };
            return acme.accounts.create(accReg).then(function(receipt) {
                var reg = {
                    keypair: keypair,
                    receipt: receipt,
                    // shudder... not actually a KeyID... but so it is called anyway...
                    kid:
                        receipt &&
                        receipt.key &&
                        (receipt.key.kid || receipt.kid),
                    email: args.email,
                    subscriberEmail: email,
                    customerEmail: args.customerEmail
                };

                var keyP;
                if (kresult.exists) {
                    keyP = Promise.resolve();
                } else {
                    query.keypair = keypair;
                    query.receipt = receipt;
                    /*
					query.server = gnlck._defaults.directoryUrl.replace(
						/^https?:\/\//i,
						''
					);
                    */
                    keyP = db.setKeypair(query, keypair);
                }

                return keyP
                    .then(function() {
                        if (!db.set) {
                            return Promise.resolve({
                                keypair: keypair
                            });
                        }
                        return db.set(
                            {
                                // id to be set by Store
                                email: email,
                                subscriberEmail: email,
                                customerEmail: args.customerEmail,
                                agreeTos: true,
                                agreeToTerms: true,
                                directoryUrl:
                                    args.directoryUrl ||
                                    mconf.directoryUrl ||
                                    gnlck._defaults.directoryUrl
                                /*
								server: gnlck._defaults.directoryUrl.replace(
									/^https?:\/\//i,
									''
								)
                                */
                            },
                            reg
                        );
                    })
                    .then(function(fullAccount) {
                        if (fullAccount && 'object' !== typeof fullAccount) {
                            throw new Error(
                                "accounts.set should either return 'null' or an object with an 'id' string"
                            );
                        }

                        if (!fullAccount) {
                            fullAccount = {};
                        }
                        fullAccount.keypair = keypair;
                        if (!fullAccount.key) {
                            fullAccount.key = {};
                        }
                        fullAccount.key.kid = reg.kid;

                        return fullAccount;
                    });
            });
        }
    );
};
