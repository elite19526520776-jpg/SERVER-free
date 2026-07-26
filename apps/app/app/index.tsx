import { Redirect } from 'expo-router';
import { useAuth } from '../src/state/AuthContext';

/** 入口分发：根布局的守卫会兜底，这里只是把首屏直接落到正确的位置 */
export default function Index() {
  const { status } = useAuth();
  if (status === 'signedIn') return <Redirect href="/chats" />;
  return <Redirect href="/login" />;
}
