import React, { useState, useEffect, useCallback, useMemo, FC, useRef } from 'react';
import { HomeIcon, MapIcon, HistoryIcon, CogIcon, PawPrintIcon, PlusCircleIcon, TrashIcon, BellIcon, PlayIcon, DistanceIcon, ZzzIcon } from './components/icons';

// --- CONSTANTS ---
const HOME_RADIUS_KM = 0.05; // 50 meters
const WALK_START_CONFIRMATION_COUNT = 3; 
const WALK_END_CONFIRMATION_COUNT = 2;   
const LOCAL_STORAGE_KEY = 'dog-walk-tracker-data';
const HIGH_ACCURACY_GEOLOCATION_OPTIONS: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
};
const LOW_POWER_GEOLOCATION_OPTIONS: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 20000,
    maximumAge: 60000,
};
const LOW_POWER_INTERVAL = 2 * 60 * 1000; // 2 minutes
const ZONE_COLORS = ['#F87171', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', '#F472B6'];


// --- TYPES ---
type View = 'home' | 'zones' | 'history' | 'settings';

interface Zone {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius: number; // in km
    color: string;
}

interface Walk {
    id: string;
    startTime: number;
    endTime: number | null;
    duration: number; // in seconds
    distance: number; // in km
    path: { lat: number; lng: number }[];
    zonesVisited: string[]; 
}

interface NotificationSettings {
    enabled: boolean;
    hours: number;
}

interface StoredData {
    homeZone: Zone | null;
    customZones: Zone[];
    walks: Walk[];
    settings: NotificationSettings;
}


// --- HELPER FUNCTIONS ---
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const formatDuration = (seconds: number, style: 'short' | 'long' = 'short'): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (style === 'long') {
        let parts = [];
        if (h > 0) parts.push(`${h} hr`);
        if (m > 0) parts.push(`${m} min`);
        if (h === 0 && m === 0) parts.push(`${s} sec`);
        return parts.join(' ') || '0 sec';
    }

    let result = '';
    if (h > 0) result += `${h}h `;
    if (m > 0) result += `${m}m `;
    if (h === 0 && m === 0) result += `${s}s`;
    return result.trim() || '0s';
};

const formatTimeSince = (timestamp: number): { value: string, unit: string } => {
    if (!timestamp) return { value: '', unit: '' };
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);

    if (seconds < 60) return { value: seconds.toString(), unit: "seconds" };
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return { value: minutes.toString(), unit: minutes === 1 ? "minute" : "minutes" };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { value: hours.toString(), unit: hours === 1 ? "hour" : "hours" };
    const days = Math.floor(hours / 24);
    return { value: days.toString(), unit: days === 1 ? "day" : "days" };
};


// --- UI COMPONENTS ---

const Header: FC<{ setView: (view: View) => void }> = ({ setView }) => (
    <header className="sticky top-0 z-10 p-4 flex items-center justify-between">
        <PawPrintIcon className="w-8 h-8 text-brand-light" />
        <h1 className="text-xl font-bold text-brand-light">Fido's Last Walk</h1>
        <button onClick={() => setView('settings')} className="text-brand-light">
            <CogIcon className="w-7 h-7" />
        </button>
    </header>
);

const BottomNav: FC<{ currentView: View; setView: (view: View) => void; }> = ({ currentView, setView }) => {
    const navItems = [
        { id: 'home', icon: HomeIcon, label: 'Home' },
        { id: 'history', icon: HistoryIcon, label: 'History' },
        { id: 'zones', icon: MapIcon, label: 'Zones' },
    ] as const;

    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-brand-dark/80 backdrop-blur-sm border-t border-brand-card flex justify-around">
            {navItems.map(item => (
                <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={`flex-1 p-2 flex flex-col items-center justify-center text-sm transition-colors ${currentView === item.id ? 'text-brand-accent' : 'text-brand-secondary hover:text-brand-light'}`}
                >
                    <item.icon className="w-7 h-7 mb-1" />
                    <span className="font-medium">{item.label}</span>
                </button>
            ))}
        </nav>
    );
};

const PermissionsGate: FC<{ onGrant: () => void }> = ({ onGrant }) => (
    <div className="flex flex-col items-center justify-center h-screen bg-brand-dark text-brand-light p-4 text-center">
        <PawPrintIcon className="w-24 h-24 text-brand-accent mb-6" />
        <h1 className="text-3xl font-bold mb-2">Welcome to Dog Walk Tracker</h1>
        <p className="mb-6 max-w-md text-brand-secondary">To track your walks, we need access to your device's location. Your data is stored locally and is not shared.</p>
        <button onClick={onGrant} className="bg-brand-accent hover:opacity-90 text-brand-dark font-bold py-3 px-6 rounded-full shadow-lg transition-transform transform hover:scale-105">
            Grant Location Permission
        </button>
    </div>
);

const SetupHome: FC<{ onSetHome: (pos: GeolocationPosition) => void }> = ({ onSetHome }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSetHome = () => {
        setLoading(true);
        setError(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => { setLoading(false); onSetHome(pos); },
            (err) => { setLoading(false); setError(`Error: ${err.message}.`); },
            HIGH_ACCURACY_GEOLOCATION_OPTIONS
        );
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-brand-dark text-brand-light p-4 text-center">
            <HomeIcon className="w-24 h-24 text-brand-accent mb-6" />
            <h1 className="text-3xl font-bold mb-2">Set Your Home Zone</h1>
            <p className="mb-6 max-w-md text-brand-secondary">To automatically detect walks, please set your current location as "Home".</p>
            {error && <p className="text-red-400 mb-4">{error}</p>}
            <button onClick={handleSetHome} disabled={loading} className="bg-brand-accent hover:opacity-90 text-brand-dark font-bold py-3 px-6 rounded-full shadow-lg transition-transform transform hover:scale-105 disabled:bg-gray-500">
                {loading ? 'Getting Location...' : 'Set Current Location as Home'}
            </button>
        </div>
    );
};

const HomeView: FC<{ isWalking: boolean; currentWalk: Walk | null; lastWalk: Walk | null; onManualStart: () => void; }> = ({ isWalking, currentWalk, lastWalk, onManualStart }) => {
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    
    if (isWalking && currentWalk) {
        const walkDuration = Math.floor((currentTime - currentWalk.startTime) / 1000);
        return (
            <div className="p-4 text-center flex flex-col justify-center items-center h-[70vh]">
                 <h2 className="text-brand-accent text-2xl font-bold animate-pulse mb-4">Walk in Progress</h2>
                 <PawPrintIcon className="w-20 h-20 text-brand-accent mx-auto my-4"/>
                 <div className="grid grid-cols-2 gap-6 text-brand-light mt-4 w-full max-w-sm">
                     <div className="flex flex-col">
                         <span className="text-5xl font-bold">{formatDuration(walkDuration)}</span>
                         <span className="text-brand-secondary">Duration</span>
                     </div>
                     <div className="flex flex-col">
                         <span className="text-5xl font-bold">{currentWalk.distance.toFixed(2)}</span>
                         <span className="text-brand-secondary">km</span>
                     </div>
                 </div>
            </div>
        )
    }
    
    const timeSince = formatTimeSince(lastWalk?.endTime!);
    
    return (
        <div className="p-4 flex flex-col h-[calc(100vh-150px)]">
            <div className="flex-grow flex flex-col items-center justify-center text-center">
                <p className="text-brand-secondary text-lg">Time Since Last Walk</p>
                {lastWalk ? (
                    <>
                        <span className="text-8xl font-black text-brand-accent leading-none mt-2">{timeSince.value}</span>
                        <span className="text-6xl font-bold text-brand-accent leading-none">{timeSince.unit}</span>
                        <p className="text-5xl font-bold text-brand-accent">ago</p>
                    </>
                ) : (
                    <p className="text-3xl font-bold text-brand-accent mt-4">Let's go for a walk!</p>
                )}
                 <div className="mt-4 flex items-center space-x-2 text-brand-secondary/70">
                    <ZzzIcon className="w-5 h-5"/>
                    <span className="text-sm font-medium">Low Power Monitoring</span>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-brand-card p-4 rounded-2xl flex flex-col items-start space-y-2">
                    <div className="flex items-center space-x-2 text-brand-accent">
                        <DistanceIcon className="w-5 h-5" />
                        <span className="text-sm font-semibold">Distance</span>
                    </div>
                    <p className="text-2xl font-bold text-brand-light">{lastWalk ? `${lastWalk.distance.toFixed(2)} km` : '—'}</p>
                </div>
                 <div className="bg-brand-card p-4 rounded-2xl flex flex-col items-start space-y-2">
                    <div className="flex items-center space-x-2 text-brand-accent">
                        <HomeIcon className="w-5 h-5" />
                        <span className="text-sm font-semibold">Last Duration</span>
                    </div>
                    <p className="text-2xl font-bold text-brand-light">{lastWalk ? formatDuration(lastWalk.duration, 'long') : '—'}</p>
                </div>
            </div>

            <button onClick={onManualStart} className="w-full flex items-center justify-center p-4 bg-brand-accent text-brand-dark rounded-full font-bold text-lg shadow-lg">
                <PlayIcon className="w-6 h-6 mr-2" />
                Start Walk
            </button>
        </div>
    );
};

const ZonesView: FC<{ customZones: Zone[]; currentPosition: GeolocationPosition | null; onAddZone: (name: string, lat: number, lng: number, radius: number, color: string) => void; onDeleteZone: (id: string) => void; }> = ({ customZones, currentPosition, onAddZone, onDeleteZone }) => {
    const [zoneName, setZoneName] = useState('');
    const [zoneRadius, setZoneRadius] = useState('100');
    const [zoneColor, setZoneColor] = useState(ZONE_COLORS[0]);

    const handleAddZone = () => {
        if (!zoneName.trim() || !currentPosition) return;
        const radiusMeters = parseInt(zoneRadius, 10);
        if (isNaN(radiusMeters) || radiusMeters <= 0) return;
        onAddZone(zoneName, currentPosition.coords.latitude, currentPosition.coords.longitude, radiusMeters / 1000, zoneColor);
        setZoneName('');
        setZoneRadius('100');
        setZoneColor(ZONE_COLORS[0]);
    };
    
    return (
        <div className="p-4">
            <h2 className="text-3xl font-bold text-brand-light mb-4">Named Zones</h2>
            <div className="bg-brand-card p-4 rounded-2xl mb-6 space-y-4">
                <h3 className="text-lg font-bold text-brand-light">Create New Zone</h3>
                <input type="text" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g., Park Entrance" className="w-full bg-brand-dark border border-brand-card text-brand-light rounded-lg p-3 focus:ring-brand-accent focus:border-brand-accent"/>
                <input type="number" value={zoneRadius} onChange={(e) => setZoneRadius(e.target.value)} placeholder="100" className="w-full bg-brand-dark border border-brand-card text-brand-light rounded-lg p-3 focus:ring-brand-accent focus:border-brand-accent"/>
                <div className="flex justify-between items-center py-2">
                    {ZONE_COLORS.map(color => (
                        <button key={color} style={{ backgroundColor: color }} onClick={() => setZoneColor(color)} className={`w-8 h-8 rounded-full transition-transform transform hover:scale-110 ${zoneColor === color ? 'ring-2 ring-offset-2 ring-offset-brand-card ring-brand-light' : ''}`}/>
                    ))}
                </div>
                <button onClick={handleAddZone} disabled={!currentPosition} className="w-full flex items-center justify-center p-3 bg-brand-accent text-brand-dark rounded-full font-bold hover:opacity-90 disabled:bg-gray-500">
                    <PlusCircleIcon className="w-6 h-6 mr-2" />
                    Add Current Location
                </button>
            </div>
            <div className="space-y-3">
                {customZones.map(zone => (
                    <div key={zone.id} className="bg-brand-card p-4 rounded-2xl flex justify-between items-center">
                        <div className="flex items-center">
                            <div className="w-4 h-4 rounded-full mr-4" style={{ backgroundColor: zone.color }}></div>
                            <div>
                                <p className="font-bold text-brand-light">{zone.name}</p>
                                <p className="text-sm text-brand-secondary">{zone.radius * 1000}m radius</p>
                            </div>
                        </div>
                        <button onClick={() => onDeleteZone(zone.id)} className="text-red-400 hover:text-red-500 p-2"><TrashIcon className="w-5 h-5" /></button>
                    </div>
                ))}
            </div>
        </div>
    );
};

const HistoryView: FC<{ walks: Walk[], customZones: Zone[], onDeleteWalk: (id: string) => void }> = ({ walks, customZones, onDeleteWalk }) => {
    
    const zoneColorMap = useMemo(() => {
        const map = new Map<string, string>();
        customZones.forEach(zone => map.set(zone.name, zone.color));
        return map;
    }, [customZones]);
    
    return (
        <div className="p-4">
            <h2 className="text-3xl font-bold text-brand-light mb-4">Walk History</h2>
            <div className="space-y-3">
                {[...walks].reverse().map(walk => (
                    <div key={walk.id} className="bg-brand-card p-4 rounded-2xl">
                         <div className="flex justify-between items-start">
                            <div>
                                <p className="font-bold text-brand-light">{new Date(walk.startTime).toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'})}</p>
                                <p className="text-xs text-brand-secondary">
                                    {new Date(walk.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {walk.endTime ? new Date(walk.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Ongoing'}
                                </p>
                            </div>
                            <button onClick={() => onDeleteWalk(walk.id)} className="text-red-400 hover:text-red-500 p-1 -mt-1"><TrashIcon className="w-5 h-5" /></button>
                         </div>
                         <div className="flex items-center justify-between text-brand-secondary mt-3 pt-3 border-t border-brand-dark/50">
                            <span className="font-bold text-brand-light">{formatDuration(walk.duration)}</span>
                            <span className="font-bold text-brand-light">{walk.distance.toFixed(2)} km</span>
                         </div>
                         {walk.zonesVisited.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-brand-dark/50">
                                <p className="text-xs text-brand-secondary mb-2">Zones Visited:</p>
                                <div className="flex flex-wrap gap-2">
                                    {walk.zonesVisited.map(zoneName => (
                                        <span key={zoneName} style={{ backgroundColor: zoneColorMap.get(zoneName) || '#A8A5A3' }} className="px-2 py-1 text-xs text-brand-dark font-bold rounded-full">
                                            {zoneName}
                                        </span>
                                    ))}
                                </div>
                            </div>
                         )}
                    </div>
                ))}
                {walks.length === 0 && <p className="text-center text-brand-secondary">No walks recorded yet.</p>}
            </div>
        </div>
    );
};

const SettingsView: FC<{ settings: NotificationSettings; onSettingsChange: (settings: NotificationSettings) => void; }> = ({ settings, onSettingsChange }) => {
    const handleToggle = () => {
        if (!settings.enabled && 'Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission().then(p => { if (p === 'granted') onSettingsChange({ ...settings, enabled: true }); });
        } else {
            onSettingsChange({ ...settings, enabled: !settings.enabled });
        }
    };
    
    return (
        <div className="p-4">
            <h2 className="text-3xl font-bold text-brand-light mb-4">Settings</h2>
            <div className="bg-brand-card p-4 rounded-2xl mb-4">
                <div className="flex items-center justify-between">
                     <p className="text-brand-light">Walk Reminder Notifications</p>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={settings.enabled} onChange={handleToggle} className="sr-only peer" />
                        <div className="w-11 h-6 bg-brand-dark peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-accent"></div>
                    </label>
                </div>
                {settings.enabled && (
                    <div className="mt-4 pt-4 border-t border-brand-dark">
                        <label htmlFor="hours" className="block text-sm font-medium text-brand-secondary">Notify after</label>
                        <div className="flex items-center mt-2">
                             <input type="range" id="hours" min="1" max="12" value={settings.hours} onChange={(e) => onSettingsChange({...settings, hours: parseInt(e.target.value)})} className="w-full h-2 bg-brand-dark rounded-lg appearance-none cursor-pointer accent-brand-accent"/>
                            <span className="ml-4 text-brand-light font-bold w-16 text-center">{settings.hours} hr</span>
                        </div>
                    </div>
                )}
            </div>
            <div className="bg-brand-card p-4 rounded-2xl">
                <h3 className="text-lg font-bold text-brand-light mb-2">Background Tracking</h3>
                <p className="text-sm text-brand-secondary">
                    Please note: Mobile browsers heavily restrict location tracking when the app is in the background or the screen is off. 
                    For the most reliable walk tracking, please keep this app open and on-screen during your walk.
                </p>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
export default function App() {
    const [view, setView] = useState<View>('home');
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [currentPosition, setCurrentPosition] = useState<GeolocationPosition | null>(null);
    const [isWalking, setIsWalking] = useState(false);
    const [currentWalk, setCurrentWalk] = useState<Walk | null>(null);
    
    const [storedData, setStoredData] = useState<StoredData>({
        homeZone: null, customZones: [], walks: [],
        settings: { enabled: false, hours: 8 },
    });
    
    const { homeZone, customZones, walks, settings } = storedData;
    const lastWalk = useMemo(() => walks.length > 0 ? [...walks].sort((a,b) => (b.endTime ?? 0) - (a.endTime ?? 0))[0] : null, [walks]);

    const walkStatusRef = useRef<'at_home' | 'leaving' | 'walking' | 'returning'>('at_home');
    const confirmationRef = useRef({ points: 0, startTime: 0, startPosition: null as { lat: number; lng: number } | null });

    useEffect(() => {
        const rawData = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (rawData) setStoredData(JSON.parse(rawData) as StoredData);
    }, []);

    const saveData = useCallback((data: StoredData) => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        setStoredData(data);
    }, []);

    const handleGrantPermission = useCallback(() => {
        navigator.geolocation.getCurrentPosition(() => setPermissionsGranted(true), (e) => alert(`Permission denied: ${e.message}`));
    }, []);

    const setHome = useCallback((pos: GeolocationPosition) => {
        const newHomeZone: Zone = { id: 'home', name: 'Home', latitude: pos.coords.latitude, longitude: pos.coords.longitude, radius: HOME_RADIUS_KM, color: '#A8A5A3' };
        saveData({ ...storedData, homeZone: newHomeZone });
    }, [saveData, storedData]);

    const startWalk = useCallback((startTime: number, startPosition: {lat: number, lng: number}) => {
        if(isWalking) return;
        const newWalk: Walk = { id: `walk_${startTime}`, startTime, endTime: null, duration: 0, distance: 0, path: [startPosition], zonesVisited: [] };
        setCurrentWalk(newWalk);
        setIsWalking(true);
        walkStatusRef.current = 'walking';
    }, [isWalking]);
    
    const handleManualStart = useCallback(() => {
        if (currentPosition) {
            startWalk(Date.now(), { lat: currentPosition.coords.latitude, lng: currentPosition.coords.longitude });
        } else {
            alert("Waiting for location to start walk...");
        }
    }, [currentPosition, startWalk]);
    
    const processPositionUpdate = useCallback((pos: GeolocationPosition) => {
        setCurrentPosition(pos);
        if (!homeZone) return;

        const { latitude, longitude } = pos.coords;
        const distanceFromHome = getDistance(latitude, longitude, homeZone.latitude, homeZone.longitude);

        if (walkStatusRef.current === 'at_home' && distanceFromHome > HOME_RADIUS_KM) {
            walkStatusRef.current = 'leaving';
            confirmationRef.current = { points: 1, startTime: Date.now(), startPosition: { lat: latitude, lng: longitude } };
        } else if (walkStatusRef.current === 'leaving') {
            if (distanceFromHome > HOME_RADIUS_KM) {
                confirmationRef.current.points += 1;
                if (confirmationRef.current.points >= WALK_START_CONFIRMATION_COUNT) {
                    startWalk(confirmationRef.current.startTime, confirmationRef.current.startPosition!);
                }
            } else {
                walkStatusRef.current = 'at_home';
            }
        } else if (walkStatusRef.current === 'walking' && currentWalk) {
            const lastPoint = currentWalk.path[currentWalk.path.length - 1];
            const newDistance = getDistance(lastPoint.lat, lastPoint.lng, latitude, longitude);
            const visitedZones = new Set(currentWalk.zonesVisited);
            customZones.forEach(z => { if (getDistance(latitude, longitude, z.latitude, z.longitude) <= z.radius) visitedZones.add(z.name); });
            setCurrentWalk({ ...currentWalk, distance: currentWalk.distance + newDistance, path: [...currentWalk.path, { lat: latitude, lng: longitude }], zonesVisited: Array.from(visitedZones) });
            
            if (distanceFromHome <= HOME_RADIUS_KM) {
                walkStatusRef.current = 'returning';
                confirmationRef.current = { points: 1, startTime: Date.now(), startPosition: null };
            }
        } else if (walkStatusRef.current === 'returning') {
            if (distanceFromHome <= HOME_RADIUS_KM) {
                confirmationRef.current.points += 1;
                if (confirmationRef.current.points >= WALK_END_CONFIRMATION_COUNT && currentWalk) {
                    const endTime = confirmationRef.current.startTime;
                    const completedWalk: Walk = { ...currentWalk, endTime, duration: Math.floor((endTime - currentWalk.startTime) / 1000) };
                    saveData({ ...storedData, walks: [...walks, completedWalk] });
                    setCurrentWalk(null);
                    setIsWalking(false);
                    walkStatusRef.current = 'at_home';
                }
            } else {
                walkStatusRef.current = 'walking';
            }
        }
    }, [homeZone, startWalk, currentWalk, customZones, saveData, storedData, walks]);

    useEffect(() => {
        if (!permissionsGranted || !homeZone) return;

        if (isWalking) {
            // High-accuracy tracking during a walk
            const watcherId = navigator.geolocation.watchPosition(
                processPositionUpdate,
                (err) => console.error("High-accuracy watch error:", err),
                HIGH_ACCURACY_GEOLOCATION_OPTIONS
            );
            return () => {
                navigator.geolocation.clearWatch(watcherId);
            };
        } else {
            // Low-power monitoring when at home
            const checkPosition = () => {
                navigator.geolocation.getCurrentPosition(
                    processPositionUpdate,
                    (err) => console.error("Low-power check error:", err),
                    LOW_POWER_GEOLOCATION_OPTIONS
                );
            };
            checkPosition(); // Check once immediately
            const intervalId = setInterval(checkPosition, LOW_POWER_INTERVAL);
            return () => {
                clearInterval(intervalId);
            };
        }
    }, [isWalking, permissionsGranted, homeZone, processPositionUpdate]);
    
    useEffect(() => {
        if(!settings.enabled || isWalking || !lastWalk?.endTime) return;
        const checkInterval = setInterval(() => {
            if(Date.now() - lastWalk.endTime! >= settings.hours * 3600000) {
                const key = `notified_${lastWalk.id}`;
                if(!sessionStorage.getItem(key)) {
                    new Notification('Time for a walk!', { body: `It's been over ${settings.hours} hours!` });
                    sessionStorage.setItem(key, 'true');
                }
            }
        }, 300000); // check every 5 minutes
        return () => clearInterval(checkInterval);
    }, [settings, isWalking, lastWalk])

    const addZone = (name: string, lat: number, lng: number, radius: number, color: string) => {
        const newZone: Zone = { id: `zone_${Date.now()}`, name, latitude: lat, longitude: lng, radius, color };
        saveData({ ...storedData, customZones: [...customZones, newZone] });
    };

    const deleteZone = (id: string) => {
        if(confirm("Delete this zone?")) {
            saveData({ ...storedData, customZones: customZones.filter(z => z.id !== id) });
        }
    };

    const deleteWalk = (id: string) => {
        if(confirm("Are you sure you want to delete this walk record?")) {
            saveData({ ...storedData, walks: walks.filter(w => w.id !== id) });
        }
    };

    if (!permissionsGranted) return <PermissionsGate onGrant={handleGrantPermission} />;
    if (!homeZone) return <SetupHome onSetHome={setHome} />;

    const renderView = () => {
        switch (view) {
            case 'home': return <HomeView isWalking={isWalking} currentWalk={currentWalk} lastWalk={lastWalk} onManualStart={handleManualStart} />;
            case 'zones': return <ZonesView customZones={customZones} currentPosition={currentPosition} onAddZone={addZone} onDeleteZone={deleteZone} />;
            case 'history': return <HistoryView walks={walks} customZones={customZones} onDeleteWalk={deleteWalk} />;
            case 'settings': return <SettingsView settings={settings} onSettingsChange={(s) => saveData({ ...storedData, settings: s })} />;
            default: return <HomeView isWalking={isWalking} currentWalk={currentWalk} lastWalk={lastWalk} onManualStart={handleManualStart} />;
        }
    };

    return (
        <div className="bg-brand-dark text-brand-light min-h-screen font-sans">
            <Header setView={setView} />
            <main className="pb-24">
                {renderView()}
            </main>
            <BottomNav currentView={view} setView={setView} />
        </div>
    );
}