const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const os = require("os");
const uuid = require("uuid");
const SHA256 = require("/srv/Code/SHA256.js");
const md5 = require("/srv/Code/md5.js");
const validGamemodes = ["FFA", "TEAMS"];
const teamColors = ["darkorange", "blue"]
var launch = new Date()
var logID = `/srv/Code/VibingBalls/logs/${launch.toString().split("GMT")[0]}.txt`.replace(new RegExp(" ", "g"), "_").replace(new RegExp(":", "g"), "-")
var bannedIPs = "/srv/Code/VibingBalls/bannedIPs.txt"
var bannedWords = [
    "nigger",
    "gay",
    "queer",
    "faggot",
    "cunt"
]
var bannedPhrases = [
    "password is",
    "my\\w(.*)\\wis",
    "\\d{10}",
    "\(\\d{3}\)-\\d{3}-\\d{4}",
    "\\d{3}-\\d{3}-\\d{4}"
]
fs.openSync(bannedIPs)
function log() {
    d = new Date();
    var message = arguments[0]
    if (arguments.length > 1) {
        color = arguments[0];
        message = `<${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}> `;
        for (index in Object.keys(arguments)) {
            if (index != 0) {
                key = Object.keys(arguments)[index]
                message += `${arguments[key]}`
            }
        }
    }
    fs.appendFileSync(logID,fs.existsSync(logID) ?  `${message.toString()}\n` : `-=-=START=-=-\r\n${message.toString()}`, (err, file) => { if (err) throw err; console.log("\x1b[32m%s\x1b[0m", `Log located at ${logID}`); });
    console.log.apply(null, arguments)
    //console.log(arguments)
}
var verification = {
    required: false
}
const defaults = {
    maxHealth: 10,
    radius: 20,
    buildingThickness: 20
}
var gamemode = validGamemodes[process.argv[2]] || "FFA";
const server = https.createServer({
    cert: fs.readFileSync('/etc/letsencrypt/live/alphapuggle.dev/cert.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/alphapuggle.dev/privkey.pem')
});
const disconnectCodes = {
    1000: "Normal Closure",
    1001: "Going Away",
    1002: "Protocol Error",
    1003: "Unsupported Data",
    1005: "Unknown",
    1006: "Connection Lost",
    1009: "Message Too Big",
    1012: "Service Restart",
    1014: "Bad Gateway",
    4000: "Unverified Client"
}
process.stdin.on("data", data => {
    try {
        let out = eval(data.toString())
        if(typeof(out) != "undefined") {
            console.log(out);
        }
    } catch (e) {
        console.log("\x1b[31m\x1b[1m%s\x1b[0m", `\nERROR`);
        console.log("\x1b[31m\x1b[1m%s\x1b[0m", e);
    }
})
function isJSON(data) {
    try {
        return JSON.parse(data);
        return true;
    } catch (e) {
        return false;
    }
}
class Building {
    constructor(x, width, height, color, healing = false) {
        this.x = x
        this.width = width
        this.height = height
        this.color = color
        this.healing = healing
    }
}
var buildings = {
    array: [],
    amount: 1000,
    thickness: 20,
    generate: function () {
        this.array.push(new Building(
            0,
            150,
            150,
            `rgb(${Math.floor(Math.random() * (256))}, ${Math.floor(Math.random() * (256))}, ${Math.floor(Math.random() * (256))})`, true
        ))
        for (var i = 1; i < this.amount; i++) {
            do {
                var nextBuilding = new Building(
                    Math.floor(Math.random() * (1000000) - 500000),
                    Math.floor(Math.random() * (150) + 100),
                    (Math.floor(Math.random() * (150)) + 50),
                    `rgb(${Math.floor(Math.random() * (256))}, ${Math.floor(Math.random() * (256))}, ${Math.floor(Math.random() * (256))})`,
                    false
                )
            } while (this.overlaps(nextBuilding));
            this.array.push(nextBuilding);
        }
        for (var i = 0; i < buildings.array.length / 4; i++) {
            do {
                random = Math.floor(Math.random() * this.amount);
                this.array[random].healing = true;
                this.array[random].width = 150;
                this.array[random].height = 150;
            } while (!this.array[random].healing);
        }
        log("\x1b[32m%s\x1b[0m", "Building Generation Completed");
    },
    overlaps(building) {
        overlaps = false;
        for (checkIndex in this.array) {
            check = buildings.array[checkIndex]
            if ((building.x + building.width + defaults.buildingThickness >= check.x && building.x + building.width + defaults.buildingThickness <= check.x + check.width + defaults.buildingThickness) || (building.x - defaults.buildingThickness <= check.x + check.width + defaults.buildingThickness && building.x - defaults.buildingThickness >= check.x)) {
                overlaps = true
            }
        }
        return overlaps
    }
}
const wss = new WebSocket.Server({ server })
log("\x1b[32m%s\x1b[0m", `Vibing Balls - ${gamemode} Server Started`);
buildings.generate();

var Players = []
class Player {
    constructor(color, id, username) {
        this.color = color,
        this.id = id,
        this.username = username,
        this.position = {
            x: 0,
            y: 0
        },
        this.velocity = {
            x: 0,
            y: 5
        },
        this.nextCommand = "";
        this.health = defaults.maxHealth
        this.kills = 0;
        this.deaths = 0;
        this.fired = 0;
        this.hit = 0;
    }
};
class Respawn {
    constructor(player) {
        this.player = player;
        this.timer = 250
        this.update = () => {
            this.timer--
            if (this.timer <= 0) {
                this.player.health = defaults.maxHealth
                broadcast(
                    {
                        event: "Health",
                        message: {
                            id: this.player.id,
                            health: this.player.health
                        }
                    }
                )
                Respawns.splice(Respawns.indexOf(this), 1);
            }
        }
    }
}
var Respawns = []
setInterval(() => {
    for (respawn of Respawns) {
        respawn.update();
    }
})
class Heal {
    constructor(ws) {
        this.ws = ws
        this.player = ws.player;
        this.timer = 250
        this.player.health + defaults.maxHealth / 10 <= defaults.maxHealth ? this.player.health += defaults.maxHealth / 10 : this.player.health = defaults.maxHealth
        this.update = () => {
            this.ws.healing = true;
            this.timer--
            if (this.timer <= 0) {
                this.ws.healing = false;
                broadcast(
                    {
                        event: "Health",
                        message: {
                            id: this.player.id,
                            health: this.player.health
                        }
                    }
                )
                Heals.splice(Heals.indexOf(this), 1);
            }
        }
    }
}
var Heals = []
setInterval(() => {
    for (heal of Heals) {
        heal.update();
    }
})
var health = {
    modify: (player, amount) => {
        player.health += amount;
        broadcast(
            {
                event: "Health",
                message: {
                    id: player.id,
                    health: player.health
                }
            }
        )
        if (player.health <= 0) {
            Respawns.push(new Respawn(player));
        }
    },
    set: (player, amount) => {
        player.health = amount;
        broadcast(
            {
                event: "Health",
                message: {
                    id: player.id,
                    health: player.health
                }
            }
        )
    }
}
var stats = {
    modify: (player, stat, amount) => {
        player[stat] += amount;
        broadcast(
            {
                event: "Stat",
                message: {
                    id: player.id,
                    kills: player.kills,
                    deaths: player.deaths,
                    fired: player.fired,
                    hit: player.hit
                }
            }
        )
    }
}
var Bullets = []
class Bullet {
    constructor(source, x, y) {
        this.color = source.color;
        this.firedFrom = source
        this.id = uuid.v4()
        this.velocity = {
            x: x + source.velocity.x,
            y: y 
        }
        this.position = {
            x: source.position.x,
            y: source.position.y
        }
        stats.modify(this.firedFrom, "fired", 1)
        this.update = () => {
            this.velocity.y *= .99;
            this.velocity.y += .2;
            if (this.position.y + this.velocity.y < 0) {
                this.position.x += this.velocity.x;
                this.position.y += this.velocity.y;
                for (var ws of wss.clients) {
                    var player = ws.player
                    if(typeof player != "undefined") {
                        var hitbox =
                            this.position.x + this.velocity.x > player.position.x - defaults.radius &&
                            this.position.y + this.velocity.y > player.position.y - defaults.radius &&
                            this.position.x + this.velocity.x < player.position.x + defaults.radius &&
                            this.position.y + this.velocity.y < player.position.y + defaults.radius;
        
                        if (typeof (player) != "undefined" && player.id != this.firedFrom.id && player.health > 0) {
                            if (hitbox) {
                                if (gamemode.includes("FFA") || (gamemode.includes("TEAMS") && this.firedFrom.id % 2 != player.id % 2)) {
                                    health.modify(player, -1)
                                    stats.modify(this.firedFrom, "hit", 1)
                                    log(`Player ${this.firedFrom.id} hit player ${player.id} | ${player.health}/${defaults.maxHealth}`)
                                    if (player.health <= 0) {
                                        stats.modify(this.firedFrom, "kills", 1)
                                        stats.modify(player, "deaths", 1)
                                    }
                                    this.position.y = -1
                                }
                            }
                        }
                    }
    
                }
            } else {
                Bullets.splice(Bullets.indexOf(this), 1)
            }
        }
    }
}
setInterval(
    () => {
        for (bullet of Bullets) {
            bullet.update();
        }
    }
    , 1000 / 75)
wss.on("connection", (ws, req) => {
    ws.remoteAddress = ws._socket.remoteAddress.replace("::ffff:", "")
    fs.readFileSync(bannedIPs).toString().includes(ws.remoteAddress) ? ws.close(4002, "Banned!") : null
    ws.remotePort = ws._socket.remotePort
    ws.md5Rec = false;
    ws.healing = false;
    ws.rateLimit = 1000
    ws.lastChat = Date.now() - ws.rateLimit
    send(ws,
        {
            event: "initialize",
            message: {
                buildings: buildings.array,
                defaults: defaults,
                gamemode: gamemode
            } 
        }
    )
    for (players of Players) {
        if (typeof (players) != "undefined") {
            send(ws,
                {
                    event: "Player",
                    message: players
                }
            )
        }
    }
    ws.on('message', message => {
        data = isJSON(message) ? JSON.parse(message) : { event: "nonJSON", message: message }
        var actions = {
            test: () => {
                log("Test");
            },
            player: () => {
                if (typeof (ws.player) != "undefined" && typeof (data.message) != "undefined") {
                    if (Math.abs(data.message.position.x - ws.player.position.x) > (100 * (13 + (Date.now() - ws.lastPositionTime)/13))  && ws.player.health > 0) {
                        log(`${ws.remoteAddress} - Player ${ws.player.id} - ${ws.player.username} suspect of cheating!, moved ${Math.abs(data.message.position.x - ws.player.position.x)}, ${(100 * (13 + (Date.now() - ws.lastPositionTime)/13))}`)
                        ws.close(4003, "Suspect Cheating")
                    }
                    if (ws.player.health < 0) {
                        health.set(ws.player, ws.lastHealth);
                        log("\x1b[32m%s\x1b[0m", `${ws.player.id} - ${ws.player.username} updates resumed.`)
                    }
                    ws.player.position = data.message.position
                    ws.player.velocity = data.message.velocity
                    broadcast({ event: "Player", message: ws.player }, ws)
                    ws.lastPositionTime = Date.now()
                }
            },
            md5: () => {
                if(data.message != undefined) {
                    data.message == checkClientHash() ? log("\x1b[32m%s\x1b[0m", `Verified Client - ${data.message} - ${ws.remoteAddress}:${ws.remotePort}`) : log("\x1b[31m\x1b[1m%s\x1b[0m", `Unverified Client - ${data.message} - ${ws._socket.remoteAddress.replace("::ffff:", "")}:${ws._socket.remotePort}`);
                }
                if (verification.required) {
                    ws.md5Rec = true;
                    data.message == checkClientHash() ? null : typeof data.message != "undefined" ? ws.close(4000) : ws.close(4001, "Force Refresh");
                }
            },
            requestheal: () => {
                for (index in buildings.array) {
                    building = buildings.array[index]
                    if (ws.player.position.x >= building.x - defaults.buildingThickness && ws.player.position.x <= building.x + building.width + defaults.buildingThickness) {
                        if (ws.player.position.y >= -building.height) {
                            !ws.healing && building.healing ? Heals.push(new Heal(ws)) : null;
                        }
                    }
                }
            },
            bullet: () => {
                if (ws.player.health > 0) {
                    var lastBullet = new Bullet(ws.player, data.message.x / 5, data.message.y / 5)
                    Bullets.push(lastBullet)
                    if (Bullets.length > 100) {
                        Bullets.splice(0, 1);
                    }
                    if (Bullets.length > 0) {
                        broadcast(
                            {
                                event: "BulletCreate",
                                message: {
                                    id: lastBullet.id,
                                    position: lastBullet.position,
                                    velocity: lastBullet.velocity,
                                    firedFrom: lastBullet.firedFrom.id,
                                    color: lastBullet.color
                                }
                            }
                        )
                    }
                }
            },
            createplayer: () => {
                ws.md5Rec || !verification.required ? null : ws.close(4000)
                usernameAllowed = true;
                usernameLength = data.message.username.replace(new RegExp("\w","g"), "").length 
                for (player of Players) {
                    if(typeof player != "undefined" && player.username.toLowerCase() == data.message.username.toLowerCase()) {
                        usernameAllowed = false;
                    }
                }
                if(typeof ws.player == "undefined" && usernameAllowed && usernameLength >= 3) {
                    id = Players.length;
                    for (index in Players) {
                        if (typeof Players[index] == "undefined" && index < id) {
                            id = index;
                        }
                    }
                    color = gamemode.includes("FFA") ? data.message.color != "#000000" ? data.message.color : "rgb(" + Math.floor(Math.random() * (256)) + "," + Math.floor(Math.random() * (256)) + "," + Math.floor(Math.random() * (256)) + ")" : teamColors[id % 2]
                    ws.player = new Player(color, id, data.message.username);
                    send(ws,
                        {
                            event: "assignID",
                            message: id
                        }
                    )
                    
                    Players[id] = ws.player;
                    broadcast(
                        {
                            event: "Player",
                            message: ws.player
                        }
                    )
                    broadcastTooltip("tooltip", `${ws.player.username} connected!`, 5000, "gold")
                } else if (!usernameAllowed) {
                    sendTooltip("tooltip", ws, `The username "${data.message.username}" is already connected`, 10000, "red")
                } else if (usernameLength < 3) {
                    sendTooltip("tooltip", ws, `The username "${data.message.username}" is invalid`, 10000, "red")
                }
            },
            chat: () => {
                if (data.message.replace(new RegExp(" ", "g"), "").length > 0) {
                    message = `<${ws.player.username}> ${data.message.replace(new RegExp("<", "g"), "").replace(new RegExp(">", "g"), "").replace(new RegExp("</", "g"), "")}`
                    messageAllowed = true;
                    for (word of bannedWords) {
                        censor = word[0];
                        for (character in word) {
                            if (character != 0) {
                                censor += "*"
                            }
                        }
                        message = message.replace(new RegExp(word, "g"), censor)
                    }
                    for (phrase of bannedPhrases) {
                        if (message.match(new RegExp(phrase, "g"))) {
                            messageAllowed = false;
                        }
                    }
                    if (Date.now() - ws.lastChat >= ws.rateLimit) {
                        if (messageAllowed) {
                            log(`${ws.remoteAddress} | ${message}`)
                            broadcastTooltip("message", message, 10000, ws.player.color)
                            ws.lastChat = Date.now();
                        } else {
                            sendTooltip("message", ws, "Your message contained a phrase deemed detrimental to your security. Please remember not to share any personal information on the internet!", 10000, "red")
                        }
                    } else {
                        ws.rateLimit += 1000;
                        sendTooltip("message", ws, `<ERR> Woah! You're sending a lot of messages and have been rate limited. Please wait ${((Date.now() - ws.lastChat) / 1000).toFixed(2)} second(s) before sending another message. Your rate limit has been increased to ${((ws.rateLimit) / 1000).toFixed(2)} seconds.`, 10000, "red")
                    }
                }
            },
            nonjson: () => {
                log(data.message)
            }
        }
        //console.log(data.event.toLowerCase())
        typeof (actions[data.event.toLowerCase()]) != "undefined" ? actions[data.event.toLowerCase()]() : log("\x1b[31m\x1b[1m%s\x1b[0m", `\nERROR!\n JSON recieved that was not a valid action!\n`, data);
    });
    ws.on("close", close => {
        if (typeof (ws.player) != "undefined") {
            broadcast(
                {
                    event: "PlayerDisconnect",
                    message: ws.player
                }
            )
            broadcastTooltip("tooltip", `${ws.player.username} disconnected!`, 5000, "gold")
            ws.player.id == Players.length - 1 ? Players.pop() : Players[ws.player.id] = undefined;
            while (typeof (Players[Players.length - 1]) == "undefined" && Players.length > 0) {
                Players.pop();
            }
        }
    });
    setInterval(function () { ws.ping(Date.now()); }, 500);
    ws.on("pong", pong => {
        send(ws, { event: "latency", message: Date.now() - pong });
    })

})

server.listen(8423);

function exit(code, reason) {
    wss.clients.forEach(function (client) {
        client.close((code || 1000), (reason || "Server Shutting Down"));
    });
    wss.close();
    process.exit(0);
}
function restart(code, reason) {
    wss.clients.forEach(function (client) {
        client.close((code || 1012), (reason || "Server Restarting"));
    });
    wss.close();
    process.exit(2);
}
function refresh() {
    wss.clients.forEach(function (client) {
        client.close(4001, "Force Refresh");
    });
}
function checkClientHash() {
    if(verification.required) {
        var encryptPath = fs.readFileSync("index.html").toString().replace("<!DOCTYPE html>", "").replace(/\s/g,"")
        return md5.encrypt(encryptPath)
    } else {
        return false
    }
}
function send(ws, packet) {
    ws.send(JSON.stringify(packet))
}
function broadcast(packet, sender) {
    wss.clients.forEach(function (client) {
        if (client != (sender || null)) {
            client.send(JSON.stringify(packet));
        }
    });
}
function sendTooltip(type, ws, text, duration, color) {
    send(ws, { event: type, message: { text: text, duration: duration, color: color } })
}
function broadcastTooltip(type, text, duration, color) {
    wss.clients.forEach(ws => {
        sendTooltip(type, ws, text, duration, color)
    })
}
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (Date.now() - ws.lastPositionTime >= 500 && ws.player.health >= 0) {
            ws.lastHealth = ws.player.health;
            health.set(ws.player, -1);
            log("\x1b[31m\x1b[1m%s\x1b[0m", `${ws.player.id} - ${ws.player.username} updates paused.`)
        }
    })
}, 500)
function banPlayer(playerID) {
    wss.clients.forEach(ws => {
        if (ws.player == Players[playerID]) {
            ws.close(4002, "Banned!")
            if (fs.existsSync(bannedIPs)) {
                fs.appendFileSync(bannedIPs, `${ws.remoteAddress}\n`);
                log(`${ws.remoteAddress} banned!`)
            } else {
                fs.writeFile(bannedIPs, `${ws.remoteAddress}\n`, (err, file) => { if (err) throw err; log(`${ws.remoteAddress} banned!`) })
            }
        }
    })
}
function banIP(IP) {
    var a = fs.openSync(bannedIPs, "w");
    wss.clients.forEach(ws => {
        if (ws.removeAddress == IP) {
            ws.close(4002, "Banned!")
        }
    })
    fs.writeFile(a, `${IP}\n`, (err, file) => { if (err) throw err; log(`${IP} banned!`) })
}
function pardonIP(IP) {
    var a = fs.openSync(bannedIPs, 'r');
    var b = fs.readFileSync(a).toString().replace(new RegExp(`${IP}\n`, "g"), "")
    fs.writeFileSync(bannedIPs, b)
    log(`${IP} pardoned!`)
}