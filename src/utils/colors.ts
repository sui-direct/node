export const colors = {
    reset: "\x1b[0m",
    // Foreground colors
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    // Bright foreground colors
    brightRed: "\x1b[91m",
    brightGreen: "\x1b[92m",
    brightYellow: "\x1b[93m",
    brightBlue: "\x1b[94m",
} as const;

export const colorize = {
    reset: () => colors.reset,
    error: (text: string) => `${colors.red}${text}${colors.reset}`,
    errorIcon: (text: string) => `${colors.red}✕${colors.reset} ${text}`,
    success: (text: string) => `${colors.green}${text}${colors.reset}`,
    successIcon: (text: string) => `${colors.green}✓${colors.reset} ${text}`,
    warning: (text: string) => `${colors.yellow}${text}${colors.reset}`,
    info: (text: string) => `${colors.blue}${text}${colors.reset}`,
    highlight: (text: string) => `${colors.cyan}${text}${colors.reset}`,
};
