"""File-related API routes."""

from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.params import File, Query

from topix.api.utils.decorators import with_standard_response
from topix.api.utils.security import get_current_user_uid
from topix.utils.common import gen_uid
from topix.utils.file import convert_to_base64_url, detect_mime_type, get_file_path, save_file

router = APIRouter(
    prefix="/files",
    tags=["files"],
    dependencies=[Depends(get_current_user_uid)],
    responses={404: {"description": "Not found"}},
)


@router.get("/", include_in_schema=False)
@router.get("")
@with_standard_response
async def get_file(
    response: Response,
    request: Request,
    filename: Annotated[str, Query(description="Filename to retrieve")]
):
    """Get file by filename."""
    try:
        file_path = get_file_path(filename)
    except ValueError as exc:
        # Path escaped the data root (traversal / arbitrary read) — hide it as 404.
        raise HTTPException(status_code=404, detail="Not found") from exc
    mime_type = detect_mime_type(file_path)
    base64_url = convert_to_base64_url(file_path, mime_type=mime_type)
    return {"base64_url": base64_url}


@router.post("/", include_in_schema=False)
@router.post("")
@with_standard_response
async def upload_file(
    response: Response,
    request: Request,
    file: UploadFile = File(..., description="File to upload"),
):
    """Upload a file."""
    file_bytes = await file.read()
    # Strip any client-supplied path components so the upload can't traverse out
    # of the data root (basename only); save_file confines the write as a backstop.
    safe_name = PurePath(file.filename or "").name
    mime_type = detect_mime_type(safe_name)
    if mime_type.startswith("image/"):
        cat = "images"
    else:
        cat = "files"
    new_filename = f"{gen_uid()}_{safe_name}"
    try:
        saved_path = save_file(filename=new_filename, file_bytes=file_bytes, cat=cat)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid filename") from exc
    return {
        "file": {
            "url": saved_path
        }
    }
