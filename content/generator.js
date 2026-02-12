
class ContentGenerator {
    constructor() {
        this.templates = [
            "{Hi|Hello|Hey} {there|friend|colleague}, {just checking in|hope you are well}. {Let me know|Update me} on the {project|status|files}.",
            "{Regarding|Re:} {Meeting|The call|Our chat}. {Are we still on|Is 10am good|Can we reschedule}? {Thanks|Best}, {Sender}",
            "{Quick|Short} {question|query}. {Did you get|Have you seen} the {invoice|report|memo}? {Need it soon|Please advise}.",
            "{FYI|Update}: {Server|System|Dashboard} is {down|up|slow}. {Please check|Take a look}. {Cheers|Regards}.",
            "{Happy|Good} {Monday|Friday}! {How is|Hope} the {week|weekend} {treating you|going}?"
        ];
    }

    // Basic Spintax Parser
    spin(text) {
        const regex = /\{([^{}]+)\}/g;
        return text.replace(regex, (match, choices) => {
            const parts = choices.split('|');
            return parts[Math.floor(Math.random() * parts.length)];
        });
    }

    generateSubject(topic) {
        const subjects = [
            `Project ${topic} Update`,
            `Re: ${topic} Status`,
            `Question about ${topic}`,
            `Notes from ${topic} meeting`,
            `${topic} - Action Required`
        ];
        return this.spin(subjects[Math.floor(Math.random() * subjects.length)]) + ` [Ref: ${Math.floor(Math.random() * 9999)}]`;
    }

    generateReply(originalSubject) {
        const templates = [
            "{Thanks|Got it|Noted}! {Will check|Looking into it|On it}.",
            "{Sounds good|Perfect|All set}. {Talk soon|Catch up later|Will follow up}.",
            "{Great|Awesome|Nice}, {thanks for the update|appreciate it|good to know}!",
            "{Sure|Absolutely|Of course}, {I will get back to you|let me review this|checking now}.",
            "{Understood|Makes sense|Agreed}. {Let me know if anything changes|Keep me posted}.",
            "{Thanks for sharing|Appreciate the heads up}! {Will review|Looking at it now}.",
            "{Received|Got this}, {thanks|thank you}! {Quick question|One thing} - {can we discuss later|let's sync up}?",
            "{Good stuff|Looks good}! {I'll circle back|Following up soon}."
        ];
        return this.spin(templates[Math.floor(Math.random() * templates.length)]);
    }

    generateBody(senderName, brand) {
        const template = this.templates[Math.floor(Math.random() * this.templates.length)];
        let body = this.spin(template);

        // Inject Metadata
        body = body.replace('{Sender}', senderName || 'Me');
        body = body.replace('{brand_name}', brand || 'Company');

        // Add "Cruft" (HTML Realism)
        const cruft = [
            `<div style="font-family: Arial, sans-serif; font-size: 14px;">`,
            `<div dir="ltr">`, // Gmail standard
            `<span style="color: transparent; display: none;">${Math.random().toString(36).substring(7)}</span>` // Invisible tracker-like noise
        ];

        const wrapper = cruft[Math.floor(Math.random() * cruft.length)];

        return `${wrapper}${body}</div><br><br><div style="color:#888;font-size:12px">Sent from my iPhone</div>`;
    }
}

module.exports = new ContentGenerator();
