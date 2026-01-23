import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { useEffect, useState, useCallback } from "react";
import type { ProfileFormData } from "../../../models/models";
import { supabase } from "../../../lib/supabase";
import { debounce } from "../../../utils/util";

// Username uniqueness check with debouncing
const checkUsernameUnique = async (username: string, currentUsername?: string): Promise<boolean> => {
  if (!username || username === currentUsername) return true;

  const { data, error } = await supabase
    .from('canonical_users')
    .select('username')
    .ilike('username', username)
    .limit(1);

  if (error) {
    console.error('Error checking username:', error);
    return true; // Allow on error to not block the user
  }

  return !data || data.length === 0;
};

// Field labels for display
const fieldLabels: Record<string, string> = {
  username: "Username",
  email_address: "Email Address",
  country: "Country",
  telephone_number: "Phone Number",
  telegram_handle: "Telegram Handle",
};

// Field configuration - only fields that exist in the database
const fieldConfig = {
  username: { required: true, placeholder: "your_username" },
  email_address: { required: true, placeholder: "your@email.com" },
  country: { required: false, placeholder: "United States" },
  telephone_number: { required: false, placeholder: "+1 234 567 8900" },
  telegram_handle: { required: false, placeholder: "@yourtelegram" },
};

// Yup validation schema - only fields that exist in the database
const schema = yup.object({
  username: yup.string().required("Username is required").min(3, "Username must be at least 3 characters"),
  email_address: yup
    .string()
    .email("Invalid email address")
    .required("Email address is required"),
  country: yup.string().nullable(),
  telephone_number: yup
    .string()
    .nullable()
    .test('phone-format', 'Please enter a valid phone number', (value) => {
      if (!value || value === '') return true; // Optional field
      return /^\+?[\d\s\-()]+$/.test(value);
    }),
  telegram_handle: yup
    .string()
    .nullable()
    .test('telegram-format', 'Telegram handle must start with @', (value) => {
      if (!value || value === '') return true; // Optional field
      return value.startsWith('@');
    }),
});

const ProfileForm = ({
  isEditMode,
  setIsEditMode,
  profile,
  setProfile,
}: {
  isEditMode?: boolean;
  setIsEditMode: (e: boolean) => void;
  profile: ProfileFormData;
  setProfile: (e: ProfileFormData) => void;
}) => {
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ProfileFormData>({
    resolver: yupResolver(schema) as any,
    defaultValues: profile,
  });

  const watchedUsername = watch("username");

  // Debounced username check - using useMemo to create stable debounced function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedCheckUsername = useCallback(
    debounce(async (username: string) => {
      if (!username || username.length < 3) {
        setUsernameError(null);
        setCheckingUsername(false);
        return;
      }

      setCheckingUsername(true);
      const isUnique = await checkUsernameUnique(username, profile.username);
      setCheckingUsername(false);

      if (!isUnique) {
        setUsernameError("This username is already taken");
      } else {
        setUsernameError(null);
      }
    }, 500),
    [profile.username]
  );

  // Check username on change
  useEffect(() => {
    if (isEditMode && watchedUsername !== profile.username) {
      debouncedCheckUsername(watchedUsername);
    } else {
      setUsernameError(null);
    }
  }, [watchedUsername, isEditMode, profile.username, debouncedCheckUsername]);

  // Reset form when profile changes
  useEffect(() => {
    reset(profile);
  }, [profile, reset]);

  const onSubmit = async (data: ProfileFormData) => {
    // Final username check before save
    if (data.username !== profile.username) {
      const isUnique = await checkUsernameUnique(data.username, profile.username);
      if (!isUnique) {
        setUsernameError("This username is already taken");
        return;
      }
    }

    setProfile(data);
    setIsEditMode(false);
  };

  const handleCancel = () => {
    reset(profile);
    setUsernameError(null);
    setIsEditMode(false);
  };

  // Order fields for display - only fields that exist in the database
  const fieldOrder = [
    "username",
    "email_address",
    "country",
    "telephone_number",
    "telegram_handle",
  ];

  return (
    <div className="mt-10 space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {fieldOrder.map((name) => {
          const config = fieldConfig[name as keyof typeof fieldConfig];
          const label = fieldLabels[name] || name.replace(/_/g, " ");
          const isRequired = config?.required;
          const placeholder = config?.placeholder || "";

          return (
            <div key={name} className="flex flex-col">
              <label className="text-xl mb-2 sequel-75 text-[#E5EE00]">
                {label}
                {isRequired && <span className="text-red-500 ml-1">*</span>}
                {!isRequired && <span className="text-white/50 text-sm ml-2">(optional)</span>}
              </label>

              {isEditMode ? (
                <>
                  <input
                    {...register(name as keyof ProfileFormData)}
                    placeholder={placeholder}
                    className="bg-[#fff]/25 text-white sequel-45 rounded-sm px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E5EE00]"
                  />
                  {errors[name as keyof ProfileFormData] && (
                    <span className="text-red-400 text-sm mt-1 sequel-45">
                      {errors[name as keyof ProfileFormData]?.message}
                    </span>
                  )}
                  {name === "username" && checkingUsername && (
                    <span className="text-white/50 text-sm mt-1 sequel-45">
                      Checking availability...
                    </span>
                  )}
                  {name === "username" && usernameError && !checkingUsername && (
                    <span className="text-red-400 text-sm mt-1 sequel-45">
                      {usernameError}
                    </span>
                  )}
                  {name === "username" && !checkingUsername && !usernameError && watchedUsername !== profile.username && watchedUsername?.length >= 3 && (
                    <span className="text-green-400 text-sm mt-1 sequel-45">
                      Username available!
                    </span>
                  )}
                </>
              ) : (
                <p className="text-white sequel-45">
                  {profile[name as keyof ProfileFormData] || "—"}
                </p>
              )}
            </div>
          );
        })}

        <div className="gap-3 mt-10 sm:block grid">
          {isEditMode && (
            <>
              <button
                type="submit"
                disabled={!!usernameError || checkingUsername}
                className="bg-[#E5EE00] uppercase sm:text-lg text-black sequel-95 hover:bg-[#E5EE00]/90 px-8 py-3 cursor-pointer rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="bg-white sm:ml-4 uppercase sm:text-lg text-black sequel-95 hover:bg-white/90 px-8 py-3 cursor-pointer rounded-lg"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
};

export default ProfileForm;
