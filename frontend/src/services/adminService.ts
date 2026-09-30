import { useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';
import { parseAdminUsersList } from '../utils/apiResponseSchemas';

export interface UserProfile {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    role: 'admin' | 'user';
    package: 'free' | 'pro';
    createdAt: { _seconds: number };
    lastLogin: { _seconds: number };
}

export const useAdminService = () => {
    const { user } = useAuth();
    const baseUrl = getResolvedApiBaseUrl();

    const fetchUsers = useCallback(async (): Promise<UserProfile[]> => {
        if (!user) throw new Error('Not authenticated');

        const response = await fetch(`${baseUrl}/admin/users`, {
            headers: {
                ...(await getFirebaseAuthHeader())
            }
        });

        const text = await response.text();
        if (!response.ok) {
            // Try to parse JSON error body, but fall back to raw text when not JSON
            try {
                const errJson = JSON.parse(text);
                throw new Error(errJson.error?.message || `Failed to fetch users (${response.status})`);
            } catch {
                // Non-JSON body (HTML/plain text) -- include it for easier debugging
                throw new Error(`Failed to fetch users (${response.status}): ${text.slice(0, 200)}`);
            }
        }

        // Parse successful JSON body, but guard against invalid JSON
        try {
            const raw: unknown = JSON.parse(text);
        return parseAdminUsersList(raw) as unknown as UserProfile[];
    } catch {
        throw new Error('Failed to parse users response: invalid JSON');
    }
    }, [user, baseUrl]);

    const updateUserPackage = useCallback(async (targetUid: string, newPackage: 'free' | 'pro'): Promise<void> => {
        if (!user) throw new Error('Not authenticated');

        const response = await fetch(`${baseUrl}/admin/users/${targetUid}/package`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(await getFirebaseAuthHeader())
            },
            body: JSON.stringify({ package: newPackage })
        });

        const text = await response.text();
        if (!response.ok) {
            try {
                const errJson = JSON.parse(text);
                throw new Error(errJson.error?.message || `Failed to update package (${response.status})`);
            } catch {
        throw new Error(`Failed to update package (${response.status}): ${text.slice(0,200)}`);
            }
        }
    }, [user, baseUrl]);

    const updateUserRole = useCallback(async (targetUid: string, newRole: 'admin' | 'user'): Promise<void> => {
        if (!user) throw new Error('Not authenticated');

        const response = await fetch(`${baseUrl}/admin/users/${targetUid}/role`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(await getFirebaseAuthHeader())
            },
            body: JSON.stringify({ role: newRole })
        });

        const text = await response.text();
        if (!response.ok) {
            try {
                const errJson = JSON.parse(text);
                throw new Error(errJson.error?.message || `Failed to update role (${response.status})`);
            } catch {
        throw new Error(`Failed to update role (${response.status}): ${text.slice(0,200)}`);
            }
        }
    }, [user, baseUrl]);

    return {
        fetchUsers,
        updateUserPackage,
        updateUserRole
    };
};
