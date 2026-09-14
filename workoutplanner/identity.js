const PROFILE_COLUMNS = `
  id,
  clerk_user_id,
  role,
  display_name,
  created_at,
  updated_at
`;

function normalizeClerkUserId(value) {
  const clerkUserId = String(value || "").trim();
  if (!/^user_[A-Za-z0-9_-]+$/.test(clerkUserId)) {
    throw new TypeError("A verified Clerk user ID is required.");
  }
  return clerkUserId;
}

async function findProfileByClerkUserId(db, clerkUserId) {
  const normalizedClerkUserId = normalizeClerkUserId(clerkUserId);
  const result = await db.query(
    `SELECT ${PROFILE_COLUMNS}
       FROM public.profiles
      WHERE clerk_user_id = $1
      LIMIT 1`,
    [normalizedClerkUserId]
  );
  return result.rows[0] || null;
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    clerkUserId: profile.clerk_user_id,
    role: profile.role,
    displayName: profile.display_name,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  };
}

module.exports = {
  findProfileByClerkUserId,
  normalizeClerkUserId,
  publicProfile
};