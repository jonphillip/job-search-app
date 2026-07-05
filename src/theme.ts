import { createTheme } from "@aws-amplify/ui-react";

/**
 * "Old web revival" theme for the Amplify Authenticator.
 * Dark panels, burnt-orange accent, monospace type, hard 1px borders,
 * zero border-radius, no shadows.
 */
export const theme = createTheme({
  name: "old-web-revival",
  tokens: {
    colors: {
      background: {
        primary: { value: "#0f0f0f" },
        secondary: { value: "#141414" },
        tertiary: { value: "#1a1a1a" },
      },
      font: {
        primary: { value: "#ccccbb" },
        secondary: { value: "#ccccbb" },
        tertiary: { value: "#666660" },
        inverse: { value: "#0f0f0f" },
      },
      border: {
        primary: { value: "#333" },
        secondary: { value: "#333" },
        tertiary: { value: "#333" },
      },
      // Burnt orange accent mapped onto the brand scale used by buttons/links.
      brand: {
        primary: {
          10: { value: "#2a140a" },
          20: { value: "#48200f" },
          40: { value: "#8a3614" },
          60: { value: "#b04518" },
          80: { value: "#c94e1a" },
          90: { value: "#d8632f" },
          100: { value: "#e3774a" },
        },
      },
    },
    fonts: {
      default: {
        variable: { value: '"Courier Prime", monospace' },
        static: { value: '"Courier Prime", monospace' },
      },
    },
    // Kill all rounding.
    radii: {
      xs: { value: "0" },
      small: { value: "0" },
      medium: { value: "0" },
      large: { value: "0" },
      xl: { value: "0" },
      xxl: { value: "0" },
      xxxl: { value: "0" },
      full: { value: "0" },
    },
    // No shadows anywhere.
    shadows: {
      small: { value: "none" },
      medium: { value: "none" },
      large: { value: "none" },
    },
    components: {
      authenticator: {
        router: {
          backgroundColor: { value: "#141414" },
          borderColor: { value: "#333" },
          borderWidth: { value: "1px" },
          borderStyle: { value: "solid" },
          boxShadow: { value: "none" },
        },
      },
      fieldcontrol: {
        color: { value: "#ccccbb" },
        borderColor: { value: "#333" },
        borderRadius: { value: "0" },
        _focus: {
          borderColor: { value: "#c94e1a" },
          boxShadow: { value: "none" },
        },
      },
      button: {
        borderRadius: { value: "0" },
        primary: {
          backgroundColor: { value: "#c94e1a" },
          color: { value: "#0f0f0f" },
          _hover: {
            backgroundColor: { value: "#d8632f" },
            color: { value: "#0f0f0f" },
          },
          _active: {
            backgroundColor: { value: "#b04518" },
          },
          _focus: {
            backgroundColor: { value: "#d8632f" },
            boxShadow: { value: "none" },
          },
        },
        link: {
          color: { value: "#c94e1a" },
          _hover: {
            color: { value: "#d8632f" },
            backgroundColor: { value: "#1a1a1a" },
          },
        },
      },
      tabs: {
        item: {
          color: { value: "#666660" },
          borderColor: { value: "#333" },
          _active: {
            color: { value: "#c94e1a" },
            borderColor: { value: "#c94e1a" },
          },
          _hover: {
            color: { value: "#ccccbb" },
          },
        },
      },
      heading: {
        color: { value: "#ccccbb" },
      },
    },
  },
});
