
const moment = require('moment-timezone');

class Scheduler {
    constructor() {
        this.baseStartHour = 9;
        this.baseEndHour = 18;
    }

    /**
     * Checks if the current time is within the working hours for the given timezone.
     * Applies a deterministic jitter based on the date to "wobble" the start time per day.
     * @param {string} timezone - e.g. "America/New_York"
     * @returns {boolean}
     */
    isWorkingHour(timezone) {
        if (!timezone) timezone = "UTC";

        const now = moment().tz(timezone);
        const dayOfWeek = now.day(); // 0=Sun, 6=Sat

        // 1. Weekend Check (Reduce volume or stop)
        // For now, let's say strict NO on weekends for safety
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            // Maybe allow 10% chance? For now, simplistic safety.
            // return Math.random() < 0.1;
            return false;
        }

        // 2. Jitter Calculation
        // Hash the date string to get a consistent random number for TODAY
        const dateStr = now.format('YYYY-MM-DD');
        const hash = this._simpleHash(dateStr);
        const jitterMinutes = (hash % 90) - 45; // +/- 45 minutes

        const start = moment(now).startOf('day').add(this.baseStartHour, 'hours').add(jitterMinutes, 'minutes');
        const end = moment(now).startOf('day').add(this.baseEndHour, 'hours');

        return now.isBetween(start, end);
    }

    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    getReplyDelay() {
        // Return random delay between 60 minutes and 480 minutes (8 hours) in milliseconds
        const min = 60;
        const max = 480;
        const delayMins = Math.floor(Math.random() * (max - min + 1)) + min;
        return delayMins * 60 * 1000;
    }
}

module.exports = new Scheduler();
