import React, { useEffect } from 'react';
import { useNavigate } from '../utils/router';

export default function AboutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/settings?tab=about', { replace: true });
  }, [navigate]);

  return null;
}
