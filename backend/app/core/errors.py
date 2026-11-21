"""Domain errors that map to stable, user-facing API error payloads."""


class AppError(Exception):
    status_code = 400
    code = "error"
    message = "Something went wrong."

    def __init__(self, message: str | None = None):
        super().__init__(message or self.message)
        if message:
            self.message = message


class InvalidImageError(AppError):
    status_code = 400
    code = "invalid_image"
    message = "Please upload a valid JPG or PNG image."


class ImageTooLargeError(AppError):
    status_code = 413
    code = "image_too_large"
    message = "This image is too large. Please upload an image under the size limit."


class OwnerToolsDisabledError(AppError):
    status_code = 503
    code = "owner_tools_disabled"
    message = "Owner tools are switched off on this server. Set ADMIN_TOKEN to enable them."


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"
    message = "That owner access key is not correct."


class ProductNotFoundError(AppError):
    status_code = 404
    code = "product_not_found"
    message = "This product no longer exists."


class InvalidProductError(AppError):
    status_code = 422
    code = "invalid_product"
    message = "Some product details are missing or invalid."


class AnalysisFailedError(AppError):
    status_code = 500
    code = "analysis_failed"
    message = "We couldn't analyze this room. Please try another image."
