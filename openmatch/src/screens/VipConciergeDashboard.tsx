import React, { useState, useEffect } from 'react';
import { 
    View, 
    Text, 
    StyleSheet, 
    Pressable, 
    ScrollView, 
    SafeAreaView, 
    Platform, 
    ActivityIndicator,
    Dimensions
} from 'react-native';
import { ProfileRecord } from '../lib/profile';
import { supabase } from '../lib/supabase';
import { submitInterestRequest } from '../lib/intentEscrowApi';

const { width } = Dimensions.get('window');
const isTablet = width > 768;

interface CuratedCandidate {
    id: string;
    initials: string;
    location: string;
    compatibility: number;
    status: string;
    statusColor: string;
}

export default function VipConciergeDashboard({
    viewerProfile,
    onViewProfile,
    onSignOut,
}: {
    viewerProfile: ProfileRecord | null;
    onViewProfile: (profileId: string) => void;
    onSignOut: () => void;
}) {
    const firstName = viewerProfile?.full_name?.split(' ')[0] || 'Member';
    const escrowCredits = viewerProfile?.unlock_credits_remaining ?? 0;
    
    const [pulse, setPulse] = useState(true);
    const [candidates, setCandidates] = useState<CuratedCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [actioningId, setActioningId] = useState<string | null>(null);

    useEffect(() => {
        const pulseInterval = setInterval(() => {
            setPulse((p) => !p);
        }, 1500);
        return () => clearInterval(pulseInterval);
    }, []);

    async function fetchVipQueue() {
        if (!viewerProfile?.id) {
            setLoading(false);
            return;
        }

        const viewerProfileId = viewerProfile.id;
        try {
            setLoading(true);

            // 1. Fetch active matches (pending or connected)
            const { data: matches, error: matchesErr } = await supabase
                .from('matches')
                .select('*')
                .or(`user_1_id.eq.${viewerProfileId},user_2_id.eq.${viewerProfileId}`)
                .in('status', ['pending', 'connected']);

            if (matchesErr) console.error('Error fetching active matches:', matchesErr);

            // Extract candidate IDs from active matches
            const activeCandidateIds = matches 
                ? matches.map((m: any) => m.user_1_id === viewerProfileId ? m.user_2_id : m.user_1_id) 
                : [];

            // Fetch candidate profiles for these active matches
            let activeProfiles: any[] = [];
            if (activeCandidateIds.length > 0) {
                const { data: profiles, error: profilesErr } = await supabase
                    .from('profiles')
                    .select('*')
                    .in('id', activeCandidateIds);
                if (profilesErr) console.error('Error fetching active profiles:', profilesErr);
                if (profiles) activeProfiles = profiles;
            }

            // Fetch interest requests for relationship status mapping
            const { data: reqs, error: reqsErr } = await supabase
                .from('interest_requests')
                .select('*')
                .or(`sender_id.eq.${viewerProfileId},receiver_id.eq.${viewerProfileId}`);

            if (reqsErr) console.error('Error fetching requests:', reqsErr);

            // Map active match profiles to CuratedCandidate list
            const activeCandidatesMapped: CuratedCandidate[] = activeProfiles.map((p: any) => {
                const req = reqs?.find((r: any) => 
                    (r.sender_id === viewerProfileId && r.receiver_id === p.id) ||
                    (r.sender_id === p.id && r.receiver_id === viewerProfileId)
                );
                
                const matchRow = matches?.find((m: any) => 
                    (m.user_1_id === viewerProfileId && m.user_2_id === p.id) ||
                    (m.user_1_id === p.id && m.user_2_id === viewerProfileId)
                );

                let statusText = 'Reviewing Profile';
                let statusColor = '#71717a';

                if (req) {
                    if (req.status === 'accepted') {
                        statusText = 'Connection Active';
                        statusColor = '#10b981';
                    } else if (req.status === 'sent') {
                        if (req.sender_id === viewerProfileId) {
                            statusText = 'Awaiting Handshake';
                            statusColor = '#E6C687';
                        } else {
                            statusText = 'Request Received';
                            statusColor = '#10b981'; 
                        }
                    }
                } else if (matchRow && matchRow.status === 'connected') {
                    statusText = 'Connection Active';
                    statusColor = '#10b981';
                } else {
                    statusText = 'Awaiting Handshake';
                    statusColor = '#E6C687';
                }

                const nameParts = p.full_name ? p.full_name.split(' ') : ['Candidate'];
                const maskedName = nameParts[0] + (nameParts[1] ? ` ${nameParts[1].charAt(0)}.` : '');

                return {
                    id: p.id,
                    initials: maskedName,
                    location: p.location || 'Unknown location',
                    compatibility: 90, // High baseline similarity since they are active matches
                    status: statusText,
                    statusColor: statusColor,
                };
            });

            // 2. Fetch fresh sourcing matches from match_profiles RPC
            const { data: recData, error: recError } = await supabase.rpc('match_profiles', {
                result_limit: 5,
                p_viewer_id: viewerProfileId
            });

            if (recError) {
                console.error('Error fetching VIP match profiles:', recError);
            }

            const recMapped: CuratedCandidate[] = [];
            if (recData && Array.isArray(recData)) {
                recData.forEach((c: any) => {
                    // Skip if they are already in the active matches queue
                    if (activeCandidateIds.includes(c.id)) return;

                    const nameParts = c.full_name ? c.full_name.split(' ') : ['Candidate'];
                    const maskedName = nameParts[0] + (nameParts[1] ? ` ${nameParts[1].charAt(0)}.` : '');

                    recMapped.push({
                        id: c.id,
                        initials: maskedName,
                        location: c.location || 'Unknown location',
                        compatibility: Math.round((c.similarity || 0.85) * 100),
                        status: 'Ready to Pitch',
                        statusColor: '#E6C687',
                    });
                });
            }

            // Combine them: active matches first, then fill up to 3 slots with new recommendations
            let combined = [...activeCandidatesMapped];
            
            // Add new recommendations to fill the rest of the queue
            for (const rec of recMapped) {
                if (combined.length >= 3) break;
                // Double check uniqueness
                if (!combined.some(x => x.id === rec.id)) {
                    combined.push(rec);
                }
            }

            setCandidates(combined);
        } catch (err) {
            console.error('Failed to load dynamic VIP queue:', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void fetchVipQueue();
    }, [viewerProfile?.id]);

    // Handle approving outreach (creates interest request under the hood!)
    async function handleApproveOutreach(candidateId: string) {
        if (!viewerProfile?.id) return;
        setActioningId(candidateId);
        try {
            await submitInterestRequest({
                candidateProfileId: candidateId,
                selectedReasonId: 'custom',
                personalizedReason: 'Highly aligned lifestyle values, pitched by Concierge Elizabeth.',
                mediaType: 'none',
                mediaUrl: null,
                voiceTranscript: null,
            });

            // Re-fetch database queue state to update status instantly
            await fetchVipQueue();
        } catch (err) {
            console.error('Error approving concierge pitch:', err);
        } finally {
            setActioningId(null);
        }
    }

    // Handle swapping out a profile (creates a pass row in matches table to exclude them)
    async function handleDeclineCandidate(candidateId: string) {
        if (!viewerProfile?.id) return;
        setActioningId(candidateId);
        try {
            const [user1, user2] = viewerProfile.id < candidateId 
                ? [viewerProfile.id, candidateId] 
                : [candidateId, viewerProfile.id];

            // Add or update a passed/rejected row to exclude this candidate from matching feed
            const { error: passErr } = await supabase
                .from('matches')
                .upsert({
                    user_1_id: user1,
                    user_2_id: user2,
                    status: 'rejected',
                    passed_at: new Date().toISOString()
                }, { onConflict: 'user_1_id,user_2_id' });

            if (passErr) throw passErr;

            // Re-fetch match feed to swap profile in real-time
            await fetchVipQueue();
        } catch (err) {
            console.error('Error declining candidate:', err);
        } finally {
            setActioningId(null);
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView 
                contentContainerStyle={styles.scrollContent} 
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerTitleRow}>
                        <Text style={styles.vipTag}>AUTONOMOUS SOURCING ENGINE</Text>
                        <View style={styles.statusBadge}>
                            <View style={[styles.statusDot, pulse && styles.statusDotActive]} />
                            <Text style={styles.statusBadgeText}>Isolated Node Active</Text>
                        </View>
                    </View>
                    <Text style={styles.welcomeTitle}>Welcome, {firstName}.</Text>
                </View>

                {/* Theater Layout */}
                <View style={styles.theaterContainer}>
                    
                    {/* Left Column: Live Outreach Focus (Active Profile) */}
                    <View style={styles.mainTheater}>
                        <Text style={styles.columnHeader}>LIVE OUTREACH FOCUS</Text>
                        
                        {loading && candidates.length === 0 ? (
                            <View style={styles.loaderContainer}>
                                <ActivityIndicator size="small" color="#E6C687" />
                                <Text style={styles.loaderText}>Sourcing real-time candidates...</Text>
                            </View>
                        ) : candidates.length === 0 ? (
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>No candidates in active pipeline yet.</Text>
                            </View>
                        ) : (
                            (() => {
                                const active = candidates[0];
                                const capitalizedName = active.initials
                                    .split(' ')
                                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                                    .join(' ');
                                
                                const isAwaiting = active.status === 'Awaiting Handshake';
                                
                                return (
                                    <View style={styles.activeCard}>
                                        {/* Shrouded Silhouette Avatar with micro-thin gold border */}
                                        <View style={styles.silhouetteContainer}>
                                            <View style={styles.shroudedAvatar}>
                                                <Text style={styles.silhouetteInitials}>
                                                    {active.initials.charAt(0).toUpperCase()}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.activeProfileInfo}>
                                            <Text style={styles.activeName}>{capitalizedName}</Text>
                                            <Text style={styles.activeLocation}>{active.location}</Text>
                                        </View>

                                        {/* Dynamic Telemetry Status */}
                                        <View style={styles.telemetryRow}>
                                            <View style={styles.liveIndicatorContainer}>
                                                <View style={[
                                                    styles.liveIndicatorDot, 
                                                    isAwaiting ? styles.liveIndicatorDotGreen : styles.liveIndicatorDotGold
                                                ]} />
                                                <Text style={[
                                                    styles.liveStatusText,
                                                    { color: isAwaiting ? '#10b981' : '#E6C687' }
                                                ]}>
                                                    {active.status}
                                                </Text>
                                            </View>
                                            <Text style={styles.alignmentStat}>{active.compatibility}% Aligned</Text>
                                        </View>

                                        <Text style={styles.pitchDescription}>
                                            {active.status === 'Ready to Pitch'
                                                ? "\"Vector parameters match lifestyle metrics. Dedicated AI voice broker Elizabeth is ready to initiate active value alignment pitching.\""
                                                : "\"Vector parameters match lifestyle metrics. Dedicated AI voice broker Elizabeth has initiated active value alignment pitching.\""}
                                        </Text>

                                        {/* Action buttons if Active Profile is Ready to Pitch */}
                                        {active.status === 'Ready to Pitch' && (
                                            <View style={styles.activeActionRow}>
                                                {actioningId === active.id ? (
                                                    <ActivityIndicator size="small" color="#E6C687" style={{ flex: 1, paddingVertical: 10 }} />
                                                ) : (
                                                    <>
                                                        <Pressable 
                                                            style={styles.declineBtn}
                                                            onPress={() => handleDeclineCandidate(active.id)}
                                                        >
                                                            <Text style={styles.declineText}>Decline / Swap</Text>
                                                        </Pressable>
                                                        <Pressable 
                                                            style={styles.approveBtn}
                                                            onPress={() => handleApproveOutreach(active.id)}
                                                        >
                                                            <Text style={styles.approveText}>Approve Outreach</Text>
                                                        </Pressable>
                                                    </>
                                                )}
                                            </View>
                                        )}
                                    </View>
                                );
                            })()
                        )}
                    </View>

                    {/* Right Column: Pipeline Queue (Index > 0) */}
                    <View style={styles.pipelineSidebar}>
                        <Text style={styles.columnHeader}>UPCOMING PIPELINE</Text>
                        
                        <View style={styles.queueContainer}>
                            {candidates.length <= 1 ? (
                                <View style={styles.emptySidebar}>
                                    <Text style={styles.emptySidebarText}>Pipeline queue empty.</Text>
                                </View>
                            ) : (
                                candidates.slice(1).map((c, idx) => {
                                    const capitalizedName = c.initials
                                        .split(' ')
                                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                                        .join(' ');

                                    const queueStatus = c.status;
                                    
                                    return (
                                        <Pressable 
                                            key={c.id} 
                                            style={styles.queuedCard}
                                            onPress={() => onViewProfile(c.id)}
                                        >
                                            <View style={styles.queuedAvatar}>
                                                <Text style={styles.queuedAvatarText}>
                                                    {c.initials.charAt(0).toUpperCase()}
                                                </Text>
                                            </View>
                                            <View style={styles.queuedInfo}>
                                                <Text style={styles.queuedName}>{capitalizedName}</Text>
                                                <Text style={styles.queuedMeta}>{c.location}</Text>
                                                <View style={styles.queuedStatusRow}>
                                                    <Text style={[styles.queuedStatusText, { color: c.statusColor || '#71717a' }]}>
                                                        {queueStatus}
                                                    </Text>
                                                    <Text style={styles.queuedCompatibility}>{c.compatibility}% Fit</Text>
                                                </View>
                                            </View>
                                        </Pressable>
                                    );
                                })
                            )}
                        </View>

                        {/* Sovereign Ledger */}
                        <View style={styles.escrowBox}>
                            <Text style={styles.escrowTitle}>🛡️ Sovereign Escrow</Text>
                            <Text style={styles.escrowText}>
                                {escrowCredits} Sourcing Credits locked. Any unanswered call instantly reverts to your ledger.
                            </Text>
                        </View>
                    </View>

                </View>

                {/* Footer */}
                <View style={styles.footer}>
                    <Pressable style={styles.signOutBtn} onPress={onSignOut}>
                        <Text style={styles.signOutText}>Sign Out VIP Session</Text>
                    </Pressable>
                    <Text style={styles.copyrightText}>© 2026 OpenMatch Sovereign. All Rights Reserved.</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
    },
    scrollContent: {
        paddingHorizontal: 24,
        paddingTop: Platform.OS === 'ios' ? 24 : 40,
        paddingBottom: 40,
        gap: 24,
    },
    header: {
        marginTop: 10,
        gap: 8,
    },
    headerTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    vipTag: {
        fontSize: 10,
        fontWeight: '800',
        color: '#E6C687',
        letterSpacing: 2,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#0c0c0e',
        borderColor: '#1d1912',
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#E6C687',
        opacity: 0.4,
    },
    statusDotActive: {
        opacity: 1,
    },
    statusBadgeText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#E6C687',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    welcomeTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: '#ffffff',
        fontFamily: Platform.OS === 'ios' ? 'Playfair Display' : 'serif',
        letterSpacing: 0.5,
    },
    theaterContainer: {
        flexDirection: isTablet ? 'row' : 'column',
        gap: 24,
        marginTop: 16,
    },
    mainTheater: {
        flex: isTablet ? 1.8 : undefined,
        gap: 12,
    },
    pipelineSidebar: {
        flex: isTablet ? 1 : undefined,
        gap: 16,
        borderLeftWidth: isTablet ? 1 : 0,
        borderLeftColor: '#161616',
        paddingLeft: isTablet ? 20 : 0,
        borderTopWidth: isTablet ? 0 : 1,
        borderTopColor: '#161616',
        paddingTop: isTablet ? 0 : 20,
    },
    columnHeader: {
        fontSize: 10,
        fontWeight: '800',
        color: '#52525b',
        letterSpacing: 2,
        marginBottom: 8,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    activeCard: {
        backgroundColor: '#09090b',
        borderWidth: 1,
        borderColor: '#1c1917',
        borderRadius: 24,
        padding: 24,
        gap: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    silhouetteContainer: {
        alignItems: 'center',
        marginVertical: 8,
    },
    shroudedAvatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#11100e',
        borderColor: 'rgba(230, 198, 135, 0.4)',
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#E6C687',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    silhouetteInitials: {
        fontSize: 24,
        color: '#E6C687',
        fontFamily: Platform.OS === 'ios' ? 'Playfair Display' : 'serif',
        opacity: 0.8,
    },
    activeProfileInfo: {
        alignItems: 'center',
        gap: 4,
    },
    activeName: {
        fontSize: 24,
        color: '#ffffff',
        fontFamily: Platform.OS === 'ios' ? 'Playfair Display' : 'serif',
        letterSpacing: 0.5,
        textAlign: 'center',
    },
    activeLocation: {
        fontSize: 13,
        color: '#71717a',
        textAlign: 'center',
    },
    telemetryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#030303',
        borderColor: '#141416',
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 16,
    },
    liveIndicatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    liveIndicatorDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 8,
    },
    liveIndicatorDotGreen: {
        backgroundColor: '#10b981',
    },
    liveIndicatorDotGold: {
        backgroundColor: '#E6C687',
    },
    liveStatusText: {
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    alignmentStat: {
        fontSize: 11,
        color: '#71717a',
        fontWeight: '700',
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    pitchDescription: {
        fontSize: 14,
        color: '#d4d4d8',
        fontStyle: 'italic',
        lineHeight: 22,
        textAlign: 'center',
        paddingHorizontal: 8,
        fontWeight: '300',
    },
    activeActionRow: {
        flexDirection: 'row',
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: '#18181b',
        paddingTop: 20,
        marginTop: 4,
    },
    approveBtn: {
        flex: 1.2,
        backgroundColor: 'rgba(230, 198, 135, 0.08)',
        borderWidth: 1,
        borderColor: '#E6C687',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    approveText: {
        color: '#E6C687',
        fontSize: 12,
        fontWeight: '700',
    },
    declineBtn: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#27272a',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    declineText: {
        color: '#71717a',
        fontSize: 12,
        fontWeight: '700',
    },
    queueContainer: {
        gap: 12,
    },
    emptySidebar: {
        paddingVertical: 32,
        alignItems: 'center',
    },
    emptySidebarText: {
        color: '#3f3f46',
        fontSize: 11,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    queuedCard: {
        flexDirection: 'row',
        backgroundColor: '#050506',
        borderColor: '#18181b',
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
        alignItems: 'center',
        gap: 12,
    },
    queuedAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#0a0a0c',
        borderColor: '#27272a',
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    queuedAvatarText: {
        color: '#71717a',
        fontSize: 14,
        fontWeight: '600',
    },
    queuedInfo: {
        flex: 1,
        gap: 2,
    },
    queuedName: {
        fontSize: 13,
        fontWeight: '700',
        color: '#ffffff',
        fontFamily: Platform.OS === 'ios' ? 'Playfair Display' : 'serif',
    },
    queuedMeta: {
        fontSize: 11,
        color: '#52525b',
    },
    queuedStatusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
    },
    queuedStatusText: {
        fontSize: 9,
        color: '#71717a',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    queuedCompatibility: {
        fontSize: 9,
        color: '#3f3f46',
        fontWeight: '700',
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    escrowBox: {
        backgroundColor: '#050403',
        borderWidth: 1,
        borderColor: '#1c150c',
        borderRadius: 16,
        padding: 16,
        gap: 4,
        marginTop: 8,
    },
    escrowTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: '#E6C687',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    escrowText: {
        fontSize: 10,
        color: '#71717a',
        lineHeight: 14,
    },
    footer: {
        alignItems: 'center',
        gap: 16,
        marginTop: 12,
    },
    signOutBtn: {
        backgroundColor: '#050505',
        borderWidth: 1,
        borderColor: '#18181b',
        paddingVertical: 12,
        borderRadius: 12,
        alignSelf: 'stretch',
        alignItems: 'center',
    },
    signOutText: {
        color: '#52525b',
        fontSize: 12,
        fontWeight: '700',
    },
    copyrightText: {
        fontSize: 9,
        color: '#27272a',
    },
    loaderContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        gap: 12,
    },
    loaderText: {
        fontSize: 11,
        color: '#71717a',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        fontSize: 12,
        color: '#71717a',
    },
});
