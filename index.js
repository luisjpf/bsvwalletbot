const Telegraf = require('telegraf');
const telegrafExtra = Telegraf.Extra;
const commandParts = require('telegraf-command-parts');
const bsv = require("bsv");
const datapay = require("datapay");
const BitIndex = require('bitindex-sdk');
const ccxt = require('ccxt');
const config = require("./config");
const db = require("./db");
const bsv_message = require("bsv-message");
const sequence = require('sequence-as-promise');
const Handcash = require('handcash');
const QRCode = require('qrcode');
const crypto = require("crypto");
const fs = require('fs');

const bot = new Telegraf(config.token);


bot.use(commandParts());

// welcomes user
bot.command('start', (ctx, next) => {
    ctx.reply(`Welcome to BSV Telegram Wallet. Simple and easy to use.
Start by creating your new address /newwallet .
Project source code at [GitHub](https://github.com/ae-ku/bsvwalletbot)
This is completely free platform, please /donate some BSV for maintenance and hosting :)`, telegrafExtra.markdown());
})

bot.command('addresses', async (ctx, next) => {
    ctx.reply("Please wait...");
    let addresses = await db.addresses.getAddressesByTgid(ctx.from.id);
    addresses.forEach((addr, index) => {

        let promises = [];
        promises.push(ctx.reply(`Address: \`${addr.addr}\`
        Balance: Loading...`, telegrafExtra.markdown()));
        sequence(promises).then(results => {
            results.forEach(async result => {
                let msgId = result.message_id;
                let balance = await getAddressBalance(addr.addr);
                let usdBalance = await convertToUSD(balance);
                ctx.telegram.editMessageText(ctx.from.id, msgId, null,
                    `Address: \`${addr.addr}\`
Balance: ${parseFloat(balance / 100000000)} BSV (~${usdBalance} USD)`, telegrafExtra.markdown()
                );
            })
        })
        /*
                getAddressBalance(addr.addr).then(async balance => {
                    let usdBalance = await convertToUSD(balance)
                    ctx.reply(`Address: \`${addr.addr}\`
        Balance: ${parseFloat(balance / 100000000)} BSV (~${usdBalance} USD)`, telegrafExtra.markdown());
                }) */
    })
})

bot.command("test", async ctx => {
    let result = await ctx.reply("Test");
    console.log(result);
})

// creates a new wallet
bot.command('newwallet', (ctx, next) => {
    let key = bsv.PrivateKey.fromRandom();
    let addr = bsv.Address.fromPrivateKey(key);
    db.addresses.addAddress({
        tgid: ctx.from.id,
        key: key.toString(),
        addr: addr.toString()
    })

    ctx.reply("New address created: `" + addr.toString() + "`\nGet your addresses using /addresses", telegrafExtra.markdown());
});

// imports a wallet
bot.command('import', async (ctx, next) => {
    if (ctx.state.command.splitArgs.length < 1) {
        let exampleKey = bsv.PrivateKey.fromRandom().toString();
        return ctx.reply("Usage: /import <private_key>. Example: /import " + exampleKey);
    }

    let keyString = ctx.state.command.splitArgs[0].toString().trim();

    // check privateKey validity
    if (!bsv.PrivateKey.isValid(keyString)) {
        return ctx.reply("Private Key is invalid");
    }

    // check if privateKey is here
    let existingAddr = await db.addresses.getAddressByKey(keyString);
    if (existingAddr) {
        // exists
        // change owner
        db.addresses.transferAddrOwner(keyString, ctx.from.id).then(() => {
            ctx.reply("Done. Imported address `" + existingAddr.addr + "` Use /addresses to get your addresses", telegrafExtra.markdown());
        });
    } else {
        // does not exist, create it
        let key = bsv.PrivateKey.fromString(keyString);
        let addr = bsv.Address.fromPrivateKey(key);
        db.addresses.addAddress({
            tgid: ctx.from.id,
            key: key.toString(),
            addr: addr.toString()
        }).then(() => {
            ctx.reply("Done. Imported address `" + addr.toString() + "` Use /addresses to get your addresses", telegrafExtra.markdown());
        })
    }

})

// balance
bot.command('balance', (ctx, next) => {
    ctx.reply("Please wait...");
    // get all addresses and their balances
    db.addresses.getAddressesByTgid(ctx.from.id).then(addresses => {
        if (addresses.length > 0) {
            let promises = [];
            addresses.forEach(addr => {
                promises.push(getAddressBalance(addr.addr));
            });
            sequence(promises).then(async balances => {
                // total balance in satoshis
                let totalBalance = balances.reduce((a, b) => a + b, 0);
                // convert to USD
                let usdBalance = await convertToUSD(totalBalance);
                ctx.reply(`Total Balance: ${parseFloat(totalBalance / 100000000)} BSV (~${usdBalance} USD)`);
            })
        } else {
            // no addresses
            ctx.reply("You dont have any address, use /newwallet to create one");
        }
    })
})

// send
bot.command('sendbsv', async (ctx, next) => {
    ctx.reply("Please wait...");
    // validate input
    if (ctx.state.command.splitArgs.length < 2) {
        let exampleKey = bsv.PrivateKey.fromRandom();
        let exampleAddr = bsv.Address.fromPrivateKey(exampleKey);
        return ctx.reply("Usage: /sendbsv <address or handcash handle> <amount in BSV or Satoshis (use . for decimals)>. Example: /sendbsv " + exampleAddr.toString() + " 1.0");
    }

    let destinationAddress = ctx.state.command.splitArgs[0].toString().trim();
    let amount = ctx.state.command.splitArgs[1];

    if (!amount || isNaN(amount)) {
        return ctx.reply("Invalid amount");
    } else {
        // convert balance to satoshis
        if (amount.indexOf(".") > -1) {
            // bsv to satoshis
            amount = parseFloat(parseFloat(amount) * 100000000);
        }
    }

    if (!destinationAddress || !bsv.Address.isValid(destinationAddress)) {
        let handcash = new Handcash({ network: "mainnet" });
        let handcashQuery = await handcash.receive(destinationAddress);
        if (!handcashQuery.receivingAddress) {
            return ctx.reply("Invalid address or handcash handle");
        } else {
            destinationAddress = handcashQuery.receivingAddress;
        }
    }

    // build up a transaction package
    let transactions = [];
    let addresses = await db.addresses.getAddressesByTgid(ctx.from.id);

    if (addresses.length > 0) {
        let pendingAmount = amount;
        let totalFees = 0;
        for (let i = 0; i < addresses.length; i++) {
            let addr = addresses[i];
            let addressBalance = await getAddressBalance(addr.addr);
            if (addressBalance >= (amount + 400)) {
                // we support this transaction with only this address
                transactions = [{
                    pay: {
                        key: addr.key,
                        fee: 400,
                        to: [
                            {
                                address: destinationAddress,
                                value: amount
                            }
                        ]
                    }
                }];
                totalFees = 400;
                pendingAmount -= (amount + 400);
                break;
            } else if (addressBalance > 400) {
                // we can support some from here
                pendingAmount -= (addressBalance - 400);
                totalFees += 400;
                transactions.push({
                    pay: {
                        key: addr.key,
                        fee: 400,
                        to: [
                            {
                                address: destinationAddress,
                                value: amount
                            }
                        ]
                    }
                });
            }
        }
        if (pendingAmount > 0) {
            return ctx.reply("Not enough balance between all your addresses");
        } else {
            // send
            let promises = [];
            transactions.forEach(txConfig => {
                promises.push(transferWithData(txConfig));
            })

            sequence(promises).then(results => {
                let msg = "Transaction Completed. Total fees: " + totalFees + " sat. TXIDs:\n"
                results.forEach(result => {
                    if (result) {
                        msg += result + "\n\n";
                    }
                })
                ctx.reply(msg);
            })
        }
    } else {
        ctx.reply("You have no addresses. Create one using /newwallet and send BSV to it first.");
    }
})

bot.command('sendusd', async ctx => {
    ctx.reply("Please wait...");
    // validate input
    if (ctx.state.command.splitArgs.length < 2) {
        let exampleKey = bsv.PrivateKey.fromRandom();
        let exampleAddr = bsv.Address.fromPrivateKey(exampleKey);
        return ctx.reply("Usage: /sendbsv <address or handcash handle> <amount in BSV or Satoshis (use . for decimals)>. Example: /sendbsv " + exampleAddr.toString() + " 1.0");
    }

    let destinationAddress = ctx.state.command.splitArgs[0].toString().trim();
    let amount = ctx.state.command.splitArgs[1];

    if (!amount || isNaN(amount)) {
        return ctx.reply("Invalid amount");
    }

    // convert amount to satoshis at current rate
    amount = await usdToSatoshis(amount);

    if (!destinationAddress || !bsv.Address.isValid(destinationAddress)) {
        let handcash = new Handcash({ network: "mainnet" });
        let handcashQuery = await handcash.receive(destinationAddress);
        if (!handcashQuery.receivingAddress) {
            return ctx.reply("Invalid address or handcash handle");
        } else {
            destinationAddress = handcashQuery.receivingAddress;
        }
    }

    // build up a transaction package
    let transactions = [];
    let addresses = await db.addresses.getAddressesByTgid(ctx.from.id);

    if (addresses.length > 0) {
        let pendingAmount = amount;
        let totalFees = 0;
        for (let i = 0; i < addresses.length; i++) {
            let addr = addresses[i];
            let addressBalance = await getAddressBalance(addr.addr);
            if (addressBalance >= (amount + 400)) {
                // we support this transaction with only this address
                transactions = [{
                    pay: {
                        key: addr.key,
                        fee: 400,
                        to: [
                            {
                                address: destinationAddress,
                                value: amount
                            }
                        ]
                    }
                }];
                totalFees = 400;
                pendingAmount -= (amount + 400);
                break;
            } else if (addressBalance > 400) {
                // we can support some from here
                pendingAmount -= (addressBalance - 400);
                totalFees += 400;
                transactions.push({
                    pay: {
                        key: addr.key,
                        fee: 400,
                        to: [
                            {
                                address: destinationAddress,
                                value: amount
                            }
                        ]
                    }
                });
            }
        }
        if (pendingAmount > 0) {
            return ctx.reply("Not enough balance between all your addresses");
        } else {
            // send
            let promises = [];
            transactions.forEach(txConfig => {
                promises.push(transferWithData(txConfig));
            })

            sequence(promises).then(results => {
                let msg = "Transaction Completed. Total fees: " + totalFees + " sat. TXIDs:\n"
                results.forEach(result => {
                    if (result) {
                        msg += result + "\n\n";
                    }
                })
                ctx.reply(msg);
            })
        }
    } else {
        ctx.reply("You have no addresses. Create one using /newwallet and send BSV to it first.");
    }
})

// receive
bot.command('receive', (ctx, next) => {
    // everytime you receive, we generate a new address for you
    let key = bsv.PrivateKey.fromRandom();
    let addr = bsv.Address.fromPrivateKey(key);

    // save the new address
    db.addresses.addAddress({
        tgid: ctx.from.id,
        key: key.toString(),
        addr: addr.toString()
    }).then(() => {
        // now generate a qr code
        let randomPath = "./images/" + crypto.randomBytes(20).toString('hex') + ".png";
        QRCode.toFile(randomPath, addr.toString(), function (err, url) {
            if (!err) {
                ctx.replyWithPhoto({
                    source: randomPath
                }, {
                        caption: '`' + addr.toString() + '`',
                        parse_mode: 'Markdown'
                    }).then(() => {
                        fs.unlink(randomPath, () => { });
                    })
            }
        })
    })
})

bot.command('donate', (ctx) => {
    ctx.reply("Please, send me some BSV to maintain this project alive: `1ErwNJ5iJr8MPZpmEn1bp8A29JfMEiXGn5`", telegrafExtra.markdown());
})

bot.launch();

const getAddressBalance = async address => {
    var bitindex = BitIndex.instance();
    var result = await bitindex.address.getStatus(address);
    let balance = result.balanceSat;
    return balance;
}

const transferValue = async (key, address, amount) => {
    return new Promise((resolve, reject) => {
        let privateKey = bsv.PrivateKey.fromString(key);
        let fromAddress = bsv.Address.fromPrivateKey(privateKey);

        getAddressBalance(fromAddress).then(balance => {
            if (balance < (amount + 400)) {
                resolve({ status: "error" });
            } else {
                var config = {
                    pay: {
                        key: key,
                        rpc: "https://api.bitindex.network",
                        fee: 400,
                        to: [{
                            address: address,
                            value: amount
                        }]
                    }
                }

                datapay.send(config, (err, result) => {
                    console.log(err, result);
                    if (err) {
                        resolve({ status: "error", msg: err })
                    } else {
                        resolve({ status: "ok" })
                    }
                });
            }
        })


    })
}

const transferWithData = async (data) => {
    return new Promise((resolve, reject) => {
        datapay.send(data, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    })
}

const convertToUSD = async (amountInSat) => {
    let amount = parseFloat(amountInSat / 100000000);

    let okex = new ccxt.okex();

    let ticker = await okex.fetchTicker("BSV/USDT");
    let price = ticker.last;

    let valueInUSD = amount * parseFloat(price);
    return valueInUSD;
}

const usdToSatoshis = async (amountInUSD) => {
    amountInUSD = parseFloat(amountInUSD);

    let okex = new ccxt.okex();

    let ticker = await okex.fetchTicker("BSV/USDT");
    let price = parseFloat(ticker.last);

    let valueInSat = amountInUSD / price;
    return valueInSat;
}

var checkPrivAgainstPublic = (key, addr) => {
    let msg = bsv_message("Hello MoneyTrain")
    let sig = msg.sign(key);
    return msg.verify(addr, sig);
}