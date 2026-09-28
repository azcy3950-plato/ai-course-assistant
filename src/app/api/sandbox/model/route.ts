import { NextResponse } from 'next/server';
import { loadCampus } from '@/lib/sandbox/server';
export const runtime='nodejs';
export async function GET(){return NextResponse.json(loadCampus().campus);}
