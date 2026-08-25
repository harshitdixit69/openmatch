import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * H14 FIX: Global error boundary to prevent white screen crashes.
 * Catches unhandled JS errors in the React component tree and shows
 * a user-friendly recovery screen instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
        // TODO (M14): Send to Sentry/LogFlare when integrated
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <View style={styles.container}>
                    <Text style={styles.emoji}>😔</Text>
                    <Text style={styles.title}>Something went wrong</Text>
                    <Text style={styles.message}>
                        The app encountered an unexpected error. Please try again.
                    </Text>
                    {__DEV__ && this.state.error && (
                        <View style={styles.debugBox}>
                            <Text style={styles.debugText}>
                                {this.state.error.toString()}
                            </Text>
                        </View>
                    )}
                    <Pressable style={styles.retryBtn} onPress={this.handleReset}>
                        <Text style={styles.retryText}>Try Again</Text>
                    </Pressable>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        backgroundColor: '#eff6f8',
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    emoji: {
        fontSize: 56,
        marginBottom: 16,
    },
    title: {
        color: '#121732',
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 8,
    },
    message: {
        color: '#5a717b',
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 24,
        textAlign: 'center',
    },
    debugBox: {
        backgroundColor: '#fef2f2',
        borderColor: '#fca5a5',
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: 24,
        maxHeight: 150,
        padding: 12,
        width: '100%',
    },
    debugText: {
        color: '#991b1b',
        fontFamily: 'monospace',
        fontSize: 12,
    },
    retryBtn: {
        backgroundColor: '#ff6a3d',
        borderRadius: 12,
        paddingHorizontal: 32,
        paddingVertical: 14,
    },
    retryText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
    },
});
