const fs = require("fs");

// helper to convert to seconds
function toSec(str) {
    let parts = str.trim().split(" ");
    let tParts = parts[0].split(":");
    let h = parseInt(tParts[0]);
    let m = parseInt(tParts[1]);
    let s = parseInt(tParts[2]);
    let ampm = "";
    if (parts.length > 1) {
        ampm = parts[1].toLowerCase();
    }

    if (h === 12) {
        if (ampm === "am") h = 0;
    } else {
        if (ampm === "pm") h = h + 12;
    }
    return (h * 3600) + (m * 60) + s;
}

// helper to convert from hours:mins:secs to seconds
function durationToSec(dur) {
    let p = dur.trim().split(":");
    return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseInt(p[2]);
}

// helper to format
function formatTime(sec) {
    if (sec < 0) sec = 0;
    let hrs = Math.floor(sec / 3600);
    let mins = Math.floor((sec % 3600) / 60);
    let secs = sec % 60;
    
    let mStr = mins.toString();
    if (mStr.length === 1) mStr = "0" + mStr;
    
    let sStr = secs.toString();
    if (sStr.length === 1) sStr = "0" + sStr;
    
    return hrs + ":" + mStr + ":" + sStr;
}

// --- Functions 1-5: Shift duration, idle time, active time, and quota checks ---
function getShiftDuration(startTime, endTime) {
    let s = toSec(startTime);
    let e = toSec(endTime);
    let diff = e - s;
    if (diff < 0) {
        diff = diff + (24 * 3600);
    }
    return formatTime(diff);
}

function getIdleTime(startTime, endTime) {
    let s = toSec(startTime);
    let e = toSec(endTime);
    if (e < s) {
        e = e + (24 * 3600);
    }
    
    let idle = 0;
    for (let i = s; i < e; i++) {
        let timeOfDay = i % (24 * 3600); 
        // before 8 am (8*3600) or after 10 pm (22*3600)
        if (timeOfDay < (8 * 3600) || timeOfDay >= (22 * 3600)) {
            idle++;
        }
    }
    return formatTime(idle);
}

function getActiveTime(shiftDuration, idleTime) {
    let shift = durationToSec(shiftDuration);
    let idle = durationToSec(idleTime);
    return formatTime(shift - idle);
}

function metQuota(date, activeTime) {
    let activeSec = durationToSec(activeTime);
    let req = (8 * 3600) + (24 * 60); // 8 hours 24 mins
    
    if (date >= "2025-04-10" && date <= "2025-04-30") {
        req = 6 * 3600; // eid
    }
    
    if (activeSec >= req) {
        return true;
    } else {
        return false;
    }
}

function addShiftRecord(textFile, shiftObj) {
    let fileLines = [];
    if (fs.existsSync(textFile)) {
        let content = fs.readFileSync(textFile, "utf8");
        fileLines = content.split("\n");
        if (fileLines.length > 0 && fileLines[fileLines.length - 1].trim() === "") {
            fileLines.pop();
        }
    }

    let lastIndex = -1;
    for (let i = 0; i < fileLines.length; i++) {
        let row = fileLines[i].split(",");
        if (row.length > 2 && row[0] === shiftObj.driverID) {
            lastIndex = i;
            if (row[2] === shiftObj.date) {
                return {}; 
            }
        }
    }

    let shiftDur = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    let idleT = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    let activeT = getActiveTime(shiftDur, idleT);
    let quota = metQuota(shiftObj.date, activeT);

    let obj = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDur,
        idleTime: idleT,
        activeTime: activeT,
        metQuota: quota,
        hasBonus: false
    };

    let lineToAdd = obj.driverID + "," + obj.driverName + "," + obj.date + "," + obj.startTime + "," + obj.endTime + "," + obj.shiftDuration + "," + obj.idleTime + "," + obj.activeTime + "," + obj.metQuota + "," + obj.hasBonus;

    if (lastIndex !== -1) {
        fileLines.splice(lastIndex + 1, 0, lineToAdd);
    } else {
        fileLines.push(lineToAdd);
    }

    let newContent = fileLines.join("\n") + "\n";
    fs.writeFileSync(textFile, newContent, "utf8");
    return obj;
}

// --- Functions 6-10: Bonus/active hours tracking and pay calculations ---
function setBonus(textFile, driverID, date, newValue) {
    try {
        let content = fs.readFileSync(textFile, "utf8");
        let lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            let row = lines[i].split(",");
            if (row.length > 2) {
                if (row[0] === driverID && row[2] === date) {
                    row[9] = String(newValue);
                    lines[i] = row.join(",");
                    break;
                }
            }
        }
        fs.writeFileSync(textFile, lines.join("\n"), "utf8");
    } catch (err) {
        // ignore
    }
}

function countBonusPerMonth(textFile, driverID, month) {
    let tMonth = parseInt(month, 10);
    let total = 0;
    let found = false;
    
    try {
        let lines = fs.readFileSync(textFile, "utf8").split("\n");
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === "") continue;
            let row = lines[i].split(",");
            if (row[0] === driverID) {
                found = true;
                let dateParts = row[2].split("-");
                if (dateParts.length === 3) {
                    let recordMonth = parseInt(dateParts[1], 10);
                    if (recordMonth === tMonth) {
                        let bonusVal = row[9].trim().toLowerCase();
                        if (bonusVal === "true") {
                            total++;
                        }
                    }
                }
            }
        }
    } catch (err) {}
    
    if (found === false) {
        return -1;
    }
    return total;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    let secs = 0;
    try {
        let lines = fs.readFileSync(textFile, "utf8").split("\n");
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === "") continue;
            let row = lines[i].split(",");
            if (row[0] === driverID) {
                let dateParts = row[2].split("-");
                if (dateParts.length === 3) {
                    if (parseInt(dateParts[1], 10) === month) {
                        secs += durationToSec(row[7]);
                    }
                }
            }
        }
    } catch (err) {}
    return formatTime(secs);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    let offDay = "";
    try {
        let rates = fs.readFileSync(rateFile, "utf8").split("\n");
        for (let i = 0; i < rates.length; i++) {
            let row = rates[i].split(",");
            if (row.length > 1 && row[0] === driverID) {
                offDay = row[1].trim();
                break;
            }
        }
    } catch (err) {}
    
    let reqSecs = 0;
    try {
        let shifts = fs.readFileSync(textFile, "utf8").split("\n");
        for (let i = 1; i < shifts.length; i++) {
            if (shifts[i].trim() === "") continue;
            let row = shifts[i].split(",");
            if (row[0] === driverID) {
                let dStr = row[2];
                let dParts = dStr.split("-");
                if (dParts.length === 3 && parseInt(dParts[1], 10) === month) {
                    let yr = parseInt(dParts[0], 10);
                    let mo = parseInt(dParts[1], 10) - 1;
                    let da = parseInt(dParts[2], 10);
                    let dObj = new Date(yr, mo, da);
                    
                    let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                    let dayOfWeek = dayNames[dObj.getDay()];
                    
                    if (dayOfWeek.toLowerCase() !== offDay.toLowerCase()) {
                        let eid = false;
                        if (dStr >= "2025-04-10" && dStr <= "2025-04-30") {
                            eid = true;
                        }
                        
                        if (eid) {
                            reqSecs = reqSecs + (6 * 3600);
                        } else {
                            reqSecs = reqSecs + (8 * 3600) + (24 * 60);
                        }
                    }
                }
            }
        }
    } catch (err) {}
    
    reqSecs = reqSecs - (bonusCount * 2 * 3600);
    if (reqSecs < 0) {
        reqSecs = 0;
    }
    
    return formatTime(reqSecs);
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    let actSec = durationToSec(actualHours);
    let reqSec = durationToSec(requiredHours);
    let miss = reqSec - actSec;
    
    if (miss <= 0) {
        miss = 0;
    }
    
    let t = 0;
    let base = 0;
    try {
        let rates = fs.readFileSync(rateFile, "utf8").split("\n");
        for (let i = 0; i < rates.length; i++) {
            let row = rates[i].split(",");
            if (row.length > 3 && row[0] === driverID) {
                base = parseInt(row[2], 10);
                t = parseInt(row[3], 10);
                break;
            }
        }
    } catch (err) {}
    
    let allowHours = 0;
    if (t === 1) allowHours = 50;
    if (t === 2) allowHours = 20;
    if (t === 3) allowHours = 10;
    if (t === 4) allowHours = 3;
    
    let allowSec = allowHours * 3600;
    miss = miss - allowSec;
    if (miss < 0) {
        miss = 0;
    }
    
    let missingFullHours = Math.floor(miss / 3600);
    let hourlyDed = Math.floor(base / 185);
    let totalDed = missingFullHours * hourlyDed;
    
    return base - totalDed;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
