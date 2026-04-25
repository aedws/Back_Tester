# Streamlit 버전 (로컬용)

루트 폴더는 Vercel 배포용 Next.js 프로젝트입니다. 이 폴더는 같은 백테스트 로직을
**로컬 파이썬**에서 Streamlit으로 돌려보고 싶을 때 쓰는 옵션입니다.

## 실행

> Python 3.11+ 필요. Microsoft Store 별칭이 아닌 실제 Python 설치본.
>
> ```powershell
> winget install Python.Python.3.12
> ```

```powershell
cd streamlit-app
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 `http://localhost:8501` 열림.
