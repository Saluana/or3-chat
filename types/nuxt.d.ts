// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            set: (name: string) => void;
            toggle: () => void;
            get: () => string;
            system: () => 'light' | 'dark';
        };
    }
}

export {};
