import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
const PASSWORD_MSG = 'Password must be 10+ characters and include a letter and a number.';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string;
  @IsString() @Length(1, 120) name: string;
  @IsString() @Length(2, 120) workspaceName: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(128) password: string;
  @IsOptional() @IsString() @MaxLength(100) deviceId?: string;
}

export class VerifyOtpDto {
  @IsString() @Length(36, 36) challengeId: string;
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code: string;
}

export class TwoFactorDto {
  @IsBoolean() enabled: boolean;
}

export class RefreshDto {
  @IsString() @Length(20, 200) refreshToken: string;
}

export class StepUpDto {
  @IsString() @MaxLength(128) password: string;
}

export class ResetRequestDto {
  @IsEmail() email: string;
}

export class ResetConfirmDto {
  @IsString() @Length(20, 200) token: string;
  @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) newPassword: string;
}
