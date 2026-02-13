"""
KimDB REST Client - Synchronous API client for KimDB
"""

import requests
import time
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass, asdict
from urllib.parse import urljoin


@dataclass
class Document:
    """Represents a KimDB document"""
    id: str
    data: Dict[str, Any]
    _version: int
    _created: Optional[str] = None
    _updated: Optional[str] = None


@dataclass
class DocumentQuery:
    """Query parameters for document retrieval"""
    limit: Optional[int] = None
    skip: Optional[int] = None
    sort: Optional[str] = None


class KimDBClient:
    """REST API client for KimDB"""

    def __init__(
        self,
        base_url: str,
        token: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: int = 30,
        retries: int = 3,
    ):
        """
        Initialize KimDB client

        Args:
            base_url: Server URL (e.g., 'http://localhost:40000')
            token: JWT token for authentication
            api_key: API Key for authentication
            timeout: Request timeout in seconds (default: 30)
            retries: Number of retries on failure (default: 3)
        """
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
        self.session = requests.Session()
        self._setup_headers()

    def _setup_headers(self) -> None:
        """Setup default headers"""
        self.session.headers.update({
            'Content-Type': 'application/json',
        })

        if self.token:
            self.session.headers.update({
                'Authorization': f'Bearer {self.token}'
            })
        elif self.api_key:
            self.session.headers.update({
                'X-API-Key': self.api_key
            })

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Make HTTP request with error handling and retries

        Args:
            method: HTTP method
            path: Request path
            data: Request body
            params: Query parameters

        Returns:
            Response JSON

        Raises:
            RequestException: If all retries fail
        """
        url = urljoin(self.base_url, path)
        last_error = None

        for attempt in range(self.retries + 1):
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    json=data,
                    params=params,
                    timeout=self.timeout,
                )

                if not response.ok:
                    error_data = response.json() if response.text else {'error': response.reason}
                    raise requests.RequestException(error_data.get('error', f'HTTP {response.status_code}'))

                return response.json()

            except requests.RequestException as error:
                last_error = error

                if attempt < self.retries:
                    wait_time = 1 * (attempt + 1)
                    time.sleep(wait_time)

        raise last_error or requests.RequestException('Unknown error')

    def health(self) -> Dict[str, Any]:
        """Get server health status"""
        return self._request('GET', '/health')

    def metrics(self) -> Dict[str, Any]:
        """Get server metrics"""
        return self._request('GET', '/api/metrics')

    def list_collections(self) -> List[str]:
        """List all collections"""
        response = self._request('GET', '/api/collections')
        return response.get('collections', [])

    def get_collection(
        self,
        collection: str,
        query: Optional[DocumentQuery] = None,
    ) -> Dict[str, Any]:
        """
        Get all documents in a collection

        Args:
            collection: Collection name
            query: Query parameters (limit, skip, sort)

        Returns:
            Collection response with documents
        """
        params = {}
        if query:
            if query.limit:
                params['limit'] = query.limit
            if query.skip:
                params['skip'] = query.skip
            if query.sort:
                params['sort'] = query.sort

        return self._request('GET', f'/api/c/{collection}', params=params)

    def get_document(self, collection: str, doc_id: str) -> Document:
        """
        Get a specific document

        Args:
            collection: Collection name
            doc_id: Document ID

        Returns:
            Document object
        """
        response = self._request('GET', f'/api/c/{collection}/{doc_id}')
        return Document(
            id=response['id'],
            data=response['data'],
            _version=response['_version'],
            _created=response.get('_created'),
            _updated=response.get('_updated'),
        )

    def query(
        self,
        sql: str,
        collection: str,
        params: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        """
        Execute SQL query

        Args:
            sql: SQL query string
            collection: Collection name
            params: Query parameters (bound variables)

        Returns:
            Query results with rows and count
        """
        body = {
            'sql': sql,
            'collection': collection,
        }
        if params:
            body['params'] = params

        return self._request('POST', '/api/sql', data=body)

    def query_users_by_age(self, min_age: int) -> List[Dict[str, Any]]:
        """Helper: Query users by minimum age"""
        response = self.query(
            'SELECT * FROM users WHERE age > ? ORDER BY name',
            'users',
            [min_age]
        )
        return response.get('rows', [])

    def count(self, collection: str, where_clause: Optional[str] = None) -> int:
        """
        Count documents in collection

        Args:
            collection: Collection name
            where_clause: Optional WHERE clause

        Returns:
            Document count
        """
        sql = f'SELECT COUNT(*) as total FROM {collection}'
        if where_clause:
            sql += f' WHERE {where_clause}'

        response = self.query(sql, collection)
        rows = response.get('rows', [])
        return rows[0].get('total', 0) if rows else 0

    def group_by(self, collection: str, field: str) -> Dict[str, int]:
        """
        Group by aggregation

        Args:
            collection: Collection name
            field: Field to group by

        Returns:
            Dictionary with group values and counts
        """
        response = self.query(
            f'SELECT {field}, COUNT(*) as count FROM {collection} GROUP BY {field}',
            collection
        )

        result = {}
        for row in response.get('rows', []):
            result[str(row[field])] = row.get('count', 0)

        return result

    def close(self) -> None:
        """Close the session"""
        self.session.close()

    def __enter__(self) -> 'KimDBClient':
        """Context manager entry"""
        return self

    def __exit__(self, *args) -> None:
        """Context manager exit"""
        self.close()
