import {supabase} from '../config/supabase';

export const getClasses = async () => {
  const {data, error} = await supabase
    .from('classes')
    .select('*');

  console.log('DATA:', data);
  console.log('ERROR:', error);

  return data || [];
};