import { Navigate, Outlet } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { useSessionSync } from '@/features/auth/hooks/useSessionSync';
import { useTokenRenewal } from '@/features/auth/hooks/useTokenRenewal';
import { useAuthStore } from '@/stores/authStore';

export const ProtectedRoute = () => {
  const player = useAuthStore((state) => state.player);

  useTokenRenewal();
  useSessionSync();

  if (!player) {
    return <Navigate to={ROUTES.login} replace />;
  }

  return <Outlet />;
};
