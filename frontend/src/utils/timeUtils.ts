export const parseDuration = (duration: string): number => {
    if (!duration) return 0;
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;

    const hours = (parseInt(match[1] || '0'));
    const minutes = (parseInt(match[2] || '0'));
    const seconds = (parseInt(match[3] || '0'));

    return hours * 3600 + minutes * 60 + seconds;
};

export const formatDuration = (duration?: string): string => {
    if (!duration) return 'N/A';
    const totalSeconds = parseDuration(duration);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
};

/** Format a numeric second count as mm:ss (or h:mm:ss). Used for avg view duration. */
export const formatSeconds = (seconds?: number): string => {
    const total = Math.round(Number(seconds) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
};

/** Format a numeric minute count (watch time) compactly: 1.2K min, 3.4M min, etc. */
export const formatMinutes = (minutes?: number): string => {
    const total = Math.round(Number(minutes) || 0);
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M min`;
    if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K min`;
    return `${total.toLocaleString()} min`;
};

export const getVideoType = (duration?: string): 'Short' | 'Long' | 'Unknown' => {
    if (!duration) return 'Unknown';
    const seconds = parseDuration(duration);
    return seconds <= 60 ? 'Short' : 'Long';
};
