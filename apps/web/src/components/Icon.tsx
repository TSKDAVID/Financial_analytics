import * as L from 'lucide-react';
import type { LucideProps } from 'lucide-react';
const map: Record<string, L.LucideIcon> = {
  briefcase: L.Briefcase, laptop: L.Laptop, building: L.Building2, home: L.Home, gift: L.Gift, 'plus-circle': L.PlusCircle, landmark: L.Landmark, repeat: L.Repeat,
  zap: L.Zap, flame: L.Flame, droplet: L.Droplet, wifi: L.Wifi, smartphone: L.Smartphone, 'shopping-cart': L.ShoppingCart, car: L.Car, 'heart-pulse': L.HeartPulse,
  shield: L.Shield, 'graduation-cap': L.GraduationCap, film: L.Film, 'shopping-bag': L.ShoppingBag, circle: L.Circle, coffee: L.Coffee, plane: L.Plane, target: L.Target,
  baby: L.Baby, dog: L.Dog, dumbbell: L.Dumbbell, utensils: L.Utensils, wrench: L.Wrench, music: L.Music, book: L.Book, 'piggy-bank': L.PiggyBank, wallet: L.Wallet, 'credit-card': L.CreditCard, banknote: L.Banknote, shirt: L.Shirt, gamepad: L.Gamepad2, bus: L.Bus, fuel: L.Fuel, pill: L.Pill, tv: L.Tv, 'trending-up': L.TrendingUp,
};
export const ICONS = Object.keys(map);
export function Icon({ name, ...p }: { name?: string | null } & LucideProps) { const C = map[name ?? ''] ?? L.Circle; return <C {...p} />; }
