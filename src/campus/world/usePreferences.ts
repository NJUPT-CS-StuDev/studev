import { useEffect, useState } from 'react';
import { readPreferences, subscribePreferences, type Preferences } from './preferences';

/**
 * The visitor's settings, read after mount (the server render knows none) and
 * kept current when they change here or in another tab.
 */
export function usePreferences(): { prefs: Preferences; ready: boolean } {
    const [state, setState] = useState<{ prefs: Preferences; ready: boolean }>({ prefs: {}, ready: false });
    useEffect(() => {
        const sync = () => setState({ prefs: readPreferences(), ready: true });
        sync();
        return subscribePreferences(sync);
    }, []);
    return state;
}
