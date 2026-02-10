
class Topology {
    /**
     * Selects a target peer for the sender.
     * Prioritizes:
     * 1. Cross-Provider (Gmail -> Microsoft)
     * 2. Recency (Haven't sent to in > 3 days)
     * 3. Friend Pool (Cluster) - if we implement strict clusters
     * @param {string} senderEmail 
     * @param {Array} allAccounts 
     * @param {Object} stateManager 
     */
    selectPeer(sender, allAccounts, stateManager) {
        // Filter out self
        let candidates = allAccounts.filter(a => a.email !== sender.email);

        if (candidates.length === 0) return null;

        const senderStats = stateManager.getAccountState(sender.email);

        // --- 1. Provider Logic (Cross-Pollination) ---
        // G -> M, M -> G
        let preferredType = null;
        if (sender.type === 'gmail') preferredType = 'microsoft';
        else if (sender.type === 'microsoft') preferredType = 'gmail';

        // Try to find preferred types
        let primaryCandidates = candidates.filter(c => c.type === preferredType);

        // Fallback if no preferred peers exist
        if (primaryCandidates.length === 0) {
            primaryCandidates = candidates;
        }

        // --- 2. Recency Logic (Weighted Random) ---
        // Score candidates by "Last Sent To" (Mock logic for now, as we don't strictly track 'last_sent_to_X' in the simple state)
        // Ideally state should look like: sent_history: { 'bob@outlook.com': timestamp }
        // For v3.4 basic, we will simplify: Pick Random. 
        // Improvement: Add 'history' to state.json later.

        // Pick one
        const target = primaryCandidates[Math.floor(Math.random() * primaryCandidates.length)];
        return target;
    }
}

module.exports = new Topology();
