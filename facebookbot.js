var fs = require('fs');
var Bot = require('node-telegram-bot');
var login = require("facebook-chat-api");

if (!process.env.TELEGRAM_USER || !process.env.APP_TOKEN)
    return console.log("Please define this env variables -- TELEGRAM_USER - APP_TOKEN");

var owner = {username: process.env.TELEGRAM_USER, chat_id: process.env.CHAT_ID || undefined};
var maxThreadNb = 10;

function getUsage() {
    return "I'm a Facebook bot. I help you to communicate with your old Facebook friends through Telegram !\n"
        + " I will forward every of your FB messages. I will also forward your answers if you select to reply their messages.\n\n"
        + "Available commands:\n"
        + "/threadlist - List the latest conversations you had with your friends.\n"
        + "/cancel - Cancel the current command.\n"
        + "/friends - La lista degli amici su facebook."
        + "\n\nMore Informations: https://github.com/silemarc/myfacebook-bot";
}

var chat = new Array();
var friends = {};
var threadListTmp;
var currentThreadId;

var config;
config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));


login({email: config.email, password: config.password}, async function (err, api) {
    if (err) return console.error(err);

    await retrieveFriendsFromFacebook(api);

    //listen telegram message
    var bot = new Bot({
        token: process.env.APP_TOKEN
    }).on('message', async function (message) {
        if (message.from.username != owner.username)
            bot.sendMessage({
                chat_id: message.chat.id,
                text: "You are not my owner! Go away ! \n"
                + "- https://github.com/silemarc/myfacebook-bot"
            });
        else {
            if (owner.chat_id == undefined)
                owner.chat_id = message.chat.id; //save owner chat id - TODO save in config file

            if (!!message.reply_to_message
                && !!chat[message.reply_to_message.message_id]) { //it is a reply message from FB

                api.sendMessage(message.text,
                    chat[message.reply_to_message.message_id], function (err, api) {
                        if (err) return console.error(err);
                    });
            } else {
                if (message.text == "/friends") {
                    bot.sendMessage({
                            chat_id: message.chat.id,
                            text: "Ho recuperato la lista dei tuoi amici da facebook. Ne ho trovati " + Object.keys(friends).length
                        },
                        function (err, ret) {
                            if (err) return console.error(err);
                        });
                }
                else if (message.text == "/threadlist") {
                    api.getThreadList(0, maxThreadNb, 'inbox', function callback(err, arr) {

                        var ft = require('./lib/findThread');
                        var fbids = ft.getParticipantsIds(arr);
                        currentThreadId = undefined; //reset current thread

                        api.getUserInfo(fbids, function (err, ret) {
                            if (err) return console.error(err);

                            ft.createThreads(arr, ret, function (conversatioNames, newThreadListTmp) {
                                threadListTmp = newThreadListTmp;
                                bot.sendMessage({
                                    chat_id: message.chat.id,
                                    text: "Who is the recipient ?",
                                    reply_markup: {
                                        keyboard: conversatioNames
                                    }
                                }, function (err, ret) {
                                    if (err) return console.error(err);
                                })
                            });
                        });
                    });
                } else if (message.text == "/cancel") {
                    reset();
                    bot.sendMessage({
                            chat_id: message.chat.id,
                            text: "Command canceled.",
                            reply_markup: {
                                hide_keyboard: true
                            }
                        },
                        function (err, ret) {
                            if (err) return console.error(err);
                        });
                } else if (currentThreadId != undefined) {
                    if (message.photo != undefined) {
                        bot.getFile({
                            file_id: message.photo[message.photo.length - 1].file_id,
                            dir: config.dir
                        }, function callback(err, arr) {
                            api.sendMessage({attachment: fs.createReadStream(arr.destination)}, currentThreadId, function (err, api) {
                                if (err) return console.error(err);
                                fs.unlink(arr.destination, function (err) {
                                    if (err) throw err;
                                });
                            });

                        });
                    } else {
                        api.sendMessage(message.text,
                            currentThreadId, function (err, api) {
                                if (err) return console.error(err);
                            });
                    }
                } else if (threadListTmp != undefined) { //Check if owner have send a good recipient name
                    currentThreadId = undefined;
                    for (var x = 0; x < threadListTmp.length; x++) {
                        if (threadListTmp[x].name == message.text)
                            currentThreadId = threadListTmp[x].threadID;
                    }

                    if (currentThreadId != undefined)
                        bot.sendMessage({
                                chat_id: message.chat.id,
                                text: "What is the message for him ?",
                                reply_markup: {
                                    hide_keyboard: true
                                }
                            },
                            function (err, ret) {
                                if (err) return console.error(err);
                            });
                    else
                        bot.sendMessage({
                                chat_id: message.chat.id,
                                text: "I do not know him, Please give me a correct name or /cancel."
                            },
                            function (err, ret) {
                                if (err) return console.error(err);
                            });
                } else {
                    bot.sendMessage({
                            chat_id: message.chat.id,
                            text: getUsage(),
                            disable_web_page_preview: true
                        },
                        function (err, ret) {
                            if (err) return console.error(err);
                        });
                }
            }
        }
    }).start();


    //listen message from FB and forward to telegram
    try {
        if (!owner.chat_id) {
            console.log("Errore! Nessuna chat telegram idetificata.");
        } else {
            api.listen(function callback(err, message) {
                if (err) {
                    console.log("Errore nel messaggio ricevuto", err);
                    // throw new Error("Errore nel messaggio ricevuto");
                }
                else if (message) {
                    const senderName = friends[message.senderID] || message.senderID;

                    if (message.attachments.length > 0) {
                        sendAttachmentsToTelegram(bot, senderName, message);
                    } else {
                        sendTextMessageToTelegram(bot, senderName, message, message.body);
                    }
                } else {
                    console.log("no message from facebook");
                }

            }); //.catch(console.log("Errore molto grave nel messaggio ricevuto"));
        }
    } catch (e) {
        console.log("Errore grave nel messaggio ricevuto", err);
        api.logout();
    }
});

const retrieveFriendsFromFacebook = async function (api) {

    return await api.getFriendsList(async function callback(err, arr) {
        if (err) {
            return console.error(err);
        }
        for (let i = 0; i < arr.length; i++) {
            friends[arr[i].userID] = arr[i].fullName;
        }
        console.log("Ho recuperato la lista dei tuoi amici da facebook. Risultano essere", arr.length);
        return arr.length;
    });
};

const sendTextMessageToTelegram = function (bot, senderName, message, text) {
    let forwardmsg = senderName + ": " + text;
    if (message.isGroup) {
        forwardmsg = message.threadID + ": " + forwardmsg;
    }

    bot.sendMessage({chat_id: owner.chat_id, text: forwardmsg}, function (err, res) {
        if (err) return console.error(err);

        //save message id send and fb thread id for futur reply
        chat[res.message_id] = message.threadID;
    })
};

const sendPhotoToTelegram = function (bot, senderName, message, filePath, caption) {
    let forwardmsg = senderName + ": " + caption;
    if (message.isGroup) {
        forwardmsg = message.threadID + ": " + forwardmsg;
    }

    bot.sendPhoto({chat_id: owner.chat_id, caption: forwardmsg, files: {photo: filePath}}, function (err, res) {
        if (err) return console.error(err);

        //save message id send and fb thread id for futur reply
        chat[res.message_id] = message.threadID;
    });
};

const sendAttachmentsToTelegram = function (bot, senderName, message) {
    for (let i = 0; i < message.attachments.length; i++) {
        const attachment = message.attachments[i];
        // Send attachments as urls
        if (!!attachment.url) {
            sendTextMessageToTelegram(bot, senderName, message, attachment.type + " - " + attachment.url);
        } else {
            console.log(attachment.type, JSON.stringify(attachment));
            const text = "invio allegati non ancora gestiti: " + attachment.type;
            sendTextMessageToTelegram(bot, senderName, message, text);
        }

        // switch (attachment.type) {
        //     case "file":
        //         sendTextMessageToTelegram(bot, senderName, message, attachment.type + " - " + attachment.url);
        //         break;
        //     case "photo":
        //         sendTextMessageToTelegram(bot, senderName, message, attachment.type + " - " + attachment.url);
        //         break;
        //     case "sticker":
        //         sendTextMessageToTelegram(bot, senderName, message, attachment.type + " - " + attachment.url);
        //         break;
        //     case "animated_image":
        //         sendTextMessageToTelegram(bot, senderName, message, attachment.type + " - " + attachment.url);
        //         break;
        //     default:
        //         console.log(attachment.type, JSON.stringify(attachment));
        //         const text = "invio allegati non ancora gestiti: " + attachment.type;
        //         sendTextMessageToTelegram(bot, senderName, message, text);
        // }
    }

}

function reset() {
    currentThreadId = undefined;
    threadListTmp = undefined;
}