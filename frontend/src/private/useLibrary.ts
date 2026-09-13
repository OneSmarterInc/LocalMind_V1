import {useMemo} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {currentSession} from '@/api/client';
import {Library} from './library';
export function useLibrary(){const {user}=useAuth();const session=currentSession();return useMemo(()=>user?new Library(user.id):null,[user,session]);}
