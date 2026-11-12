import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/mysql';

/**
 * NextAuth (v4) configuration. Kept out of the route file because App Router
 * route modules may only export HTTP handlers and route config.
 */

// Valid bcrypt hash used to burn the same CPU time when the email is unknown,
// so response timing doesn't reveal which emails are registered.
const DUMMY_HASH = '$2b$10$QyXprCcGzHMmZ6QiGbJn0ux7RUFFltcQ7kcjZgeX4/drPBpv6SIdS';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 }, // 8 hours
  pages: { signIn: '/login' },

  providers: [
    CredentialsProvider({
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');

        if (
          !email || email.length > 150 || !EMAIL_RE.test(email) ||
          !password || password.length > MAX_PASSWORD_LENGTH
        ) {
          return null;
        }

        let user;
        try {
          const rows = await query(
            `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.user_role,
                    (SELECT sm.meter_id
                       FROM smart_meters sm
                      WHERE sm.user_id = u.user_id AND sm.is_active = TRUE
                      ORDER BY sm.created_at, sm.meter_id
                      LIMIT 1) AS meter_id
               FROM users u
              WHERE u.email = ?
              LIMIT 1`,
            [email]
          );
          user = rows[0];
        } catch (err) {
          // Don't leak DB details to the client; NextAuth will surface a generic failure.
          console.error('[auth] user lookup failed:', err.message);
          throw new Error('AuthUnavailable');
        }

        const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !valid) return null;

        return {
          id: String(user.user_id),
          user_id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          user_role: user.user_role,
          meter_id: user.user_role === 'PROSUMER' ? user.meter_id ?? null : null,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on sign-in
      if (user) {
        token.user_id = user.user_id;
        token.email = user.email;
        token.full_name = user.full_name;
        token.user_role = user.user_role;
        token.meter_id = user.meter_id ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        user_id: token.user_id,
        email: token.email,
        full_name: token.full_name,
        name: token.full_name,
        user_role: token.user_role,
        meter_id: token.meter_id ?? null,
      };
      return session;
    },
  },
};
