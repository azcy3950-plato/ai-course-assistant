import { createClient } from "@supabase/supabase-js";

// Keep static builds safe; real authentication still requires deployment values.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "build-placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
