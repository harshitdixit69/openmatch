import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';

type BackButtonProps = {
    onPress: () => void;
    style?: ViewStyle;
};

export function BackButton({ onPress, style }: BackButtonProps) {
    return (
        <Pressable
            hitSlop={10}
            onPress={onPress}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, style]}
        >
            <View style={styles.chevron} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: 'center',
        backgroundColor: 'transparent',
        borderRadius: 12,
        height: 42,
        justifyContent: 'center',
        width: 42,
    },
    buttonPressed: {
        backgroundColor: 'rgba(212, 168, 83, 0.12)',
    },
    chevron: {
        borderBottomColor: '#d4a853',
        borderBottomWidth: 2.5,
        borderLeftColor: '#d4a853',
        borderLeftWidth: 2.5,
        height: 13,
        marginLeft: 4,
        transform: [{ rotate: '45deg' }],
        width: 13,
    },
});