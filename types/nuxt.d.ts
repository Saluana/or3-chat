// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            set: (name: string) => void;
            toggle: () => void; // Already exists
            get: () => string; // Already exists
            system: () => 'light' | 'dark';
        };
    }
}

export {};
