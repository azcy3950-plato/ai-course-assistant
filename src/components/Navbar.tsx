'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/contexts/AppContext';

const navLinks = {
  student: [
    { href: '/', label: '首页', icon: '🏠' },
    { href: '/knowledge', label: '知识问答', icon: '📚' },
    { href: '/guided', label: '引导学习', icon: '💡' },
    { href: '/sandbox', label: '电子沙盘', icon: '🗺️' },
    { href: '/records', label: '学习记录', icon: '📋' },
  ],
  teacher: [
    { href: '/', label: '首页', icon: '🏠' },
    { href: '/teacher', label: '教学管理', icon: '⚙️' },
    { href: '/knowledge', label: '知识问答', icon: '📚' },
    { href: '/sandbox', label: '电子沙盘', icon: '🗺️' },
  ],
};

export default function Navbar() {
  const pathname = usePathname();
  const { state, dispatch } = useApp();
  const links = navLinks[state.role];

  return (
    <nav className="bg-white border-b border-[var(--color-border)] shadow-sm sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-xl">🎓</span>
          <span className="font-bold text-lg text-[var(--color-text)] hidden sm:inline">
            AI 课程助教
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                pathname === link.href
                  ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-gray-100 hover:text-[var(--color-text)]'
              }`}
            >
              <span>{link.icon}</span>
              <span className="hidden md:inline">{link.label}</span>
            </Link>
          ))}
        </div>

        {/* Role Switcher + User */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => dispatch({ type: 'SET_ROLE', payload: 'student' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                state.role === 'student'
                  ? 'bg-white text-[var(--color-primary)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              🧑‍🎓 学生
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_ROLE', payload: 'teacher' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                state.role === 'teacher'
                  ? 'bg-white text-[var(--color-primary)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              👨‍🏫 教师
            </button>
          </div>
          <div className="text-sm text-[var(--color-text-secondary)] hidden sm:flex items-center gap-1">
            <span>{state.role === 'student' ? '🧑‍🎓' : '👨‍🏫'}</span>
            <span>{state.userName}</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
