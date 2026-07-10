import Svg, { Path } from 'react-native-svg';

type PhoneIconProps = {
    size?: number;
    color?: string;
};

/**
 * A clean solid phone/handset glyph rendered as inline SVG so it stays crisp
 * at any size and works across web + native without a raster asset.
 */
export function PhoneIcon({ size = 16, color = '#ffffff' }: PhoneIconProps) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path
                fill={color}
                d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2a1.02 1.02 0 0 1 1.05-.24c1.16.38 2.4.59 3.68.59a1.03 1.03 0 0 1 1.03 1.03V20a1.03 1.03 0 0 1-1.03 1.03C10.85 21.03 3 13.18 3 3.5A1.03 1.03 0 0 1 4.03 2.47H7.5A1.03 1.03 0 0 1 8.53 3.5c0 1.28.21 2.52.59 3.68a1.02 1.02 0 0 1-.24 1.05l-2.26 2.56z"
            />
        </Svg>
    );
}
