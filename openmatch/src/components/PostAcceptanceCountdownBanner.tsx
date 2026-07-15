import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type PostAcceptanceCountdownBannerProps = {
    firstReplyDueAt: string;
    otherUserName: string;
};

export function PostAcceptanceCountdownBanner({
    firstReplyDueAt,
    otherUserName,
}: PostAcceptanceCountdownBannerProps) {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        function updateCountdown() {
            const dueAt = new Date(firstReplyDueAt).getTime();
            if (Number.isNaN(dueAt)) {
                setTimeLeft('24 hours');
                return;
            }

            const remainingMs = dueAt - Date.now();
            if (remainingMs <= 0) {
                setTimeLeft('Expired');
                return;
            }

            const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
            if (remainingMinutes < 60) {
                setTimeLeft(`${remainingMinutes}m`);
                return;
            }

            const hours = Math.floor(remainingMinutes / 60);
            const mins = remainingMinutes % 60;
            if (hours >= 24) {
                setTimeLeft('24 hours');
            } else {
                setTimeLeft(`${hours}h ${mins}m`);
            }
        }

        updateCountdown();
        const intervalId = setInterval(updateCountdown, 10000); // update every 10 seconds for high responsiveness

        return () => clearInterval(intervalId);
    }, [firstReplyDueAt]);

    if (timeLeft === 'Expired') {
        return (
            <View style={[styles.banner, styles.bannerExpired]}>
                <Text style={styles.title}>Request Expired</Text>
                <Text style={styles.body}>This accepted match request has expired due to no reply within 24 hours.</Text>
            </View>
        );
    }

    return (
        <View style={styles.banner}>
            <View style={styles.timerBadge}>
                <Text style={styles.timerText}>⏱️ {timeLeft}</Text>
            </View>
            <View style={styles.textContainer}>
                <Text style={styles.title}>Reply Required within 24h</Text>
                <Text style={styles.body}>
                    Send a message to {otherUserName} before the timer expires to keep this match active.
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#fffbeb',
        borderColor: '#fef3c7',
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 4,
    },
    bannerExpired: {
        backgroundColor: '#fef2f2',
        borderColor: '#fee2e2',
    },
    timerBadge: {
        backgroundColor: '#fde68a',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    timerText: {
        color: '#78350f',
        fontSize: 13,
        fontWeight: '800',
    },
    textContainer: {
        flex: 1,
        gap: 2,
    },
    title: {
        color: '#78350f',
        fontSize: 14,
        fontWeight: '800',
    },
    body: {
        color: '#92400e',
        fontSize: 12,
        lineHeight: 16,
    },
});
