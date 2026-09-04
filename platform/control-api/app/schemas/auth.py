from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, model_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=512)


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    password: str = Field(min_length=1, max_length=512)
    password_confirmation: str = Field(min_length=1, max_length=512)

    @model_validator(mode="after")
    def passwords_must_match(self) -> "ResetPasswordRequest":
        if self.password != self.password_confirmation:
            raise ValueError("A confirmação da senha não confere.")
        return self


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class AuthUser(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    permissions: list[str] = Field(default_factory=list)
    companies: list[str] = Field(default_factory=list)
