import { NextResponse } from 'next/server';
import { query } from '@/db'; // Adjust this path if your db.js is located elsewhere

export async function GET() {
  try {
    // Run a simple query to get the current timestamp from Neon
    const result = await query('SELECT NOW()');
    
    return NextResponse.json({ 
      success: true, 
      time: result.rows[0].now 
    });
  } catch (error) {
    console.error('Database connection error:', error);
    return NextResponse.json(
      { success: false, error: error.message }, 
      { status: 500 }
    );
  }
}