'use client';

import React from 'react';
import { UserRole } from '@/types';

interface Props {
  role: UserRole;
  size?: 'sm' | 'md';
}

export default function RoleBadge({ role, size = 'sm' }: Props) {
  const isStudent = role === 'student';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
      } ${
        isStudent
          ? 'bg-blue-100 text-blue-700'
          : 'bg-green-100 text-green-700'
      }`}
    >
      {isStudent ? '🧑‍🎓 学生' : '👨‍🏫 教师'}
    </span>
  );
}
