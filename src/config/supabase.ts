import {createClient} from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://ocolfottogbybitfpdqy.supabase.co';
const supabaseAnonKey = 'sb_publishable_BoCDWniQc9wIgovNGYuEUQ_Gwt7_55N';

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);